import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } from 'electron'
import { join, extname } from 'node:path'
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { totalmem } from 'node:os'
import type { ChildProcess } from 'node:child_process'
import './net' // sets a tuned global undici dispatcher for the main process's Modrinth fetches
import * as store from './store'
import * as auth from './auth'
import { listVersions, launchGame, type LaunchAccount } from './game'
import { detectJava, detectAllJava } from './java'
import * as installer from './installer'
import * as loaders from './loaders'
import * as modpack from './modpack'
import * as discord from './discord'
import * as mods from './mods'
import * as modcompat from './modcompat'
import * as updater from './updater'
import { log, logsDir } from './logger'

app.setName('Beacon Launcher')
// Keep the data dir at its original "Beacon" location so renaming the app doesn't orphan
// already-installed versions/profiles (userData defaults to appData/<name>).
app.setPath('userData', join(app.getPath('appData'), 'Beacon'))
// Windows taskbar identity — makes it group/label as Beacon Launcher instead of "Electron".
if (process.platform === 'win32') app.setAppUserModelId('com.beacon.launcher')
// Kill the native menu bar entirely so ALT never drops a menu from the top.
Menu.setApplicationMenu(null)

let win: BrowserWindow | null = null
let child: ChildProcess | null = null
// Tail of the running game's output, scanned on exit for a Fabric "Incompatible mods found!" crash
// so we can show the conflict modal instead of leaving the reason buried in the log. Reset per launch.
let crashBuf = ''

function iconPath(): string | undefined {
  for (const c of [join(app.getAppPath(), 'build', 'icon.png'), join(process.cwd(), 'build', 'icon.png')]) {
    if (existsSync(c)) return c
  }
  return undefined
}

function send(channel: string, payload: unknown): void {
  win?.webContents.send(channel, payload)
}

// Per-profile install/run state — the single source of truth the UI renders from
// (sidebar badge, profile button, the parallel-installs panel in the status bar).
function pstate(id: string, status: string, percent: number, text: string): void {
  send('profileState', { id, status, percent, text })
}
function isCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { cancelled?: boolean }).cancelled === true
}

// AggregateError (from undici when every download attempt fails) hides the real cause in
// `.errors`; unwrap it so the message is actually useful (ETIMEDOUT, 404, ECONNRESET, …).
function errMsg(e: unknown): string {
  if (e instanceof AggregateError && Array.isArray(e.errors) && e.errors.length) {
    const inner = e.errors.map((x) => (x instanceof Error ? x.message : String(x))).filter(Boolean)
    if (inner.length) return `${inner.slice(0, 3).join(' · ')}${inner.length > 3 ? ` (+${inner.length - 3} more)` : ''}`
  }
  return e instanceof Error ? e.message || e.name : typeof e === 'string' ? e : JSON.stringify(e)
}

// Wrap an install progress callback so each new PHASE (not every byte-count tick) is written to the
// log — that's what makes a stuck download legible after the fact ("got to Downloading assets 40%
// then failed"). The MB counter in the text is stripped so we only log on real phase changes.
function phaseLogger(scope: string, label: string): (percent: number, text: string) => void {
  let last = ''
  return (percent, text) => {
    const phase = text.split(' — ')[0].replace(/[…✓]/g, '').trim()
    if (phase && phase !== last) {
      last = phase
      log.info(scope, `${label}: ${percent}% — ${phase}`)
    }
  }
}

// Download a freshly-created profile in the background (Minecraft + loader + Java) so it's
// ready to play. Progress is reported per-profile via 'profileState'.
function backgroundInstall(p: store.Profile): void {
  pstate(p.id, 'installing', 0, 'Preparing…')
  log.info('install', `background install started: "${p.name}" (${p.mcVersion} / ${p.loader}${p.loaderVersion ? ' ' + p.loaderVersion : ''})`)
  const logProg = phaseLogger('install', p.name)
  installer
    .prepareInstall(p, store.getSettings(), (percent, text) => {
      logProg(percent, text)
      pstate(p.id, 'installing', percent, text)
    })
    .then((ready) => {
      store.setInstallResult(p.id, ready.versionId, ready.java)
      log.info('install', `background install finished: "${p.name}" → version ${ready.versionId}`)
      pstate(p.id, 'ready', 100, 'Ready')
    })
    .catch((e) => {
      if (isCancelled(e)) {
        // This profile only exists because the user was creating it — cancelling means they backed
        // out, so drop the half-installed profile instead of leaving an empty stub behind.
        log.info('install', `background install cancelled: "${p.name}" — removing profile`)
        store.deleteProfile(p.id)
        send('profilesChanged', null)
        return
      }
      log.error('install', `background install failed: "${p.name}" (${p.mcVersion} / ${p.loader}) — ${errMsg(e)}`)
      pstate(p.id, 'error', 0, 'Install failed')
      send('toast', { text: `Install failed: ${errMsg(e)}` })
    })
}

// Import a modpack into a freshly-created profile (download its mods/config, then install base).
function backgroundImport(p: store.Profile, filePath: string): void {
  pstate(p.id, 'installing', 0, 'Importing…')
  log.info('import', `modpack import started: "${p.name}" from ${filePath}`)
  installer
    .importModpack(p, store.getSettings(), filePath, (percent, text) => pstate(p.id, 'installing', percent, text))
    .then((ready) => {
      store.setInstallResult(p.id, ready.versionId, ready.java)
      log.info('import', `modpack import finished: "${p.name}" → version ${ready.versionId}`)
      pstate(p.id, 'ready', 100, 'Ready')
    })
    .catch((e) => {
      if (isCancelled(e)) {
        // The profile was created solely for this import — cancelling means abandon it, so remove
        // the profile (and its partially-downloaded files) rather than leaving a broken pack.
        log.info('import', `modpack import cancelled: "${p.name}" — removing profile`)
        store.deleteProfile(p.id)
        send('profilesChanged', null)
        return
      }
      log.error('import', `modpack import failed: "${p.name}" — ${errMsg(e)}`)
      pstate(p.id, 'error', 0, 'Import failed')
      send('toast', { text: `Import failed: ${errMsg(e)}` })
    })
}

// Change a profile's Minecraft version as a background install: migrate its Modrinth mods to the new
// version, then re-install the base game (with progress), instead of blocking the settings dialog.
function backgroundVersionChange(p: store.Profile, mcVersion: string): void {
  pstate(p.id, 'installing', 0, 'Updating mods…')
  log.info('version', `version change started: "${p.name}" → ${mcVersion}`)
  ;(async () => {
    const r = await mods.migrateModsToVersion(p.id, mcVersion)
    store.setProfileVersion(p.id, mcVersion)
    send('profilesChanged', null)
    const profile = store.getProfile(p.id)
    if (!profile) return
    const ready = await installer.prepareInstall(profile, store.getSettings(), (percent, text) =>
      pstate(p.id, 'installing', percent, text)
    )
    store.setInstallResult(p.id, ready.versionId, ready.java)
    pstate(p.id, 'ready', 100, 'Ready')
    log.info('version', `version change finished: "${p.name}" → ${mcVersion} (${r.migrated.length} mods moved, ${r.failed.length} skipped)`)
    if (r.failed.length) send('toast', { text: `No build for ${mcVersion}, kept as-is: ${r.failed.join(', ')}` })
  })().catch((e) => {
    if (isCancelled(e)) {
      pstate(p.id, 'idle', 0, '')
      return
    }
    log.error('version', `version change failed: "${p.name}" — ${errMsg(e)}`)
    pstate(p.id, 'error', 0, 'Update failed')
    send('toast', { text: `Version change failed: ${errMsg(e)}` })
  })
}

// Download a remote image (a modpack's Modrinth icon) into the avatars folder and set it as the
// profile's avatar. Best-effort: any failure leaves the profile on its default generated avatar.
async function saveProfileAvatarFromUrl(profileId: string, url: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) return
    mkdirSync(store.avatarsRoot(), { recursive: true })
    const ext = (extname(new URL(url).pathname).toLowerCase() || '.png').slice(0, 5)
    const dest = join(store.avatarsRoot(), `${profileId}${ext}`)
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    store.setAvatar(profileId, dest)
    // Keep the public source URL too — Discord presence can only show images by URL, not the local
    // file, so this is what lets the profile's avatar appear in Rich Presence.
    store.setAvatarUrl(profileId, url)
  } catch {
    /* icon is optional — ignore network/write errors */
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    title: 'Beacon Launcher',
    icon: iconPath(),
    frame: false,
    backgroundColor: '#08090c',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('closed', () => {
    win = null
  })
  win.on('maximize', () => win?.webContents.send('winState', { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send('winState', { maximized: false }))
  // Mouse back/forward (the thumb buttons) arrive as a WM_APPCOMMAND on Windows — i.e. the main
  // process 'app-command' event, NOT a renderer DOM mouse event — so we must handle them here and
  // relay to the renderer, which runs the exact same nav as the top-bar arrows. preventDefault stops
  // Electron's built-in webContents history navigation (which would reset the SPA and, as a side
  // effect, wedge the Forward button as permanently disabled).
  win.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward') {
      e.preventDefault()
      win?.webContents.send('navBack')
    } else if (cmd === 'browser-forward') {
      e.preventDefault()
      win?.webContents.send('navForward')
    }
  })
  // macOS: the native two/three-finger trackpad swipe surfaces as the 'swipe' event (mouse thumb
  // buttons on macOS already come through the renderer's DOM mouseup fallback). Swipe right = back,
  // left = forward, matching the browser convention. Only fires on macOS; a no-op elsewhere.
  win.on('swipe', (_e, direction) => {
    if (direction === 'right') win?.webContents.send('navBack')
    else if (direction === 'left') win?.webContents.send('navForward')
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  updater.initUpdater(win)
}

app.whenReady().then(() => {
  log.info('app', `Beacon Launcher ${app.getVersion()} starting — ${process.platform} ${process.arch}, Electron ${process.versions.electron}`)
  createWindow()
  discord.setEnabled(store.getSettings().discordRpc !== false)
  discord.setActivity({ details: 'Idling' })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── app / updates ─────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => app.getVersion())
// Open the folder holding launcher.log so users can grab it for a bug report.
ipcMain.handle('logs:open', () => shell.openPath(logsDir()))
ipcMain.handle('update:check', () => updater.checkForUpdate())
ipcMain.handle('update:download', () => updater.downloadUpdate())
ipcMain.handle('update:install', () => updater.quitAndInstall())

// ── settings ────────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => store.getSettings())
ipcMain.handle('settings:set', (_e, s: store.Settings) => {
  store.saveSettings(s)
  return true
})

// ── accounts (offline nicknames + Microsoft / licensed sign-in) ───────────────
// Expose only the public parts (id/name/type/active) — never the tokens.
function publicAccounts(): { accounts: { id: string; name: string; type: string }[]; activeId: string | null } {
  const s = store.getAccounts()
  return { accounts: s.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })), activeId: s.activeId }
}
ipcMain.handle('auth:list', () => publicAccounts())
ipcMain.handle('auth:signIn', async () => {
  try {
    const account = await auth.signIn(win)
    store.upsertAccount(account) // adds (or refreshes) and makes it active
    const list = publicAccounts()
    send('authChanged', list)
    return { ok: true, list }
  } catch (e) {
    const m = errMsg(e)
    return { ok: false, error: m === 'cancelled' ? 'cancelled' : m }
  }
})
ipcMain.handle('auth:addOffline', (_e, name: string) => {
  store.addOfflineAccount(name)
  const list = publicAccounts()
  send('authChanged', list)
  return list
})
ipcMain.handle('auth:rename', (_e, a: { id: string; name: string }) => {
  store.renameAccount(a.id, a.name)
  const list = publicAccounts()
  send('authChanged', list)
  return list
})
ipcMain.handle('auth:setActive', (_e, id: string | null) => {
  store.setActiveAccount(id)
  const list = publicAccounts()
  send('authChanged', list)
  return list
})
ipcMain.handle('auth:remove', (_e, id: string) => {
  store.removeAccount(id)
  const list = publicAccounts()
  send('authChanged', list)
  return list
})

// ── profiles ──────────────────────────────────────────────────────────────
ipcMain.handle('profiles:list', () => store.getProfiles())
ipcMain.handle('profiles:add', (_e, a: { name: string; mcVersion: string; loader: store.Loader; loaderVersion?: string; avatarSrc?: string }) => {
  const p = store.addProfile(a.name, a.mcVersion, a.loader, a.loaderVersion)
  if (a.avatarSrc) {
    try {
      mkdirSync(store.avatarsRoot(), { recursive: true })
      const ext = extname(a.avatarSrc).toLowerCase() || '.png'
      const dest = join(store.avatarsRoot(), `${p.id}${ext}`)
      copyFileSync(a.avatarSrc, dest)
      store.setAvatar(p.id, dest)
      p.avatar = dest
    } catch {
      /* ignore avatar copy errors */
    }
  }
  backgroundInstall(p)
  return p
})
ipcMain.handle('profiles:rename', (_e, a: { id: string; name: string }) => {
  store.renameProfile(a.id, a.name)
  return true
})
// Set (or clear, when avatarSrc is null) an existing profile's avatar.
ipcMain.handle('profiles:setAvatar', (_e, a: { id: string; avatarSrc: string | null }) => {
  try {
    if (a.avatarSrc) {
      mkdirSync(store.avatarsRoot(), { recursive: true })
      const ext = extname(a.avatarSrc).toLowerCase() || '.png'
      const dest = join(store.avatarsRoot(), `${a.id}-${Date.now()}${ext}`)
      copyFileSync(a.avatarSrc, dest)
      store.setAvatar(a.id, dest)
    } else {
      store.setAvatar(a.id, undefined)
    }
    // A local avatar isn't a public URL, so clear any Discord-facing URL when the avatar changes.
    store.setAvatarUrl(a.id, undefined)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})
// Minecraft versions this profile could switch to while keeping all its Modrinth mods.
ipcMain.handle('content:compatibleVersions', async (_e, id: string) => {
  try {
    return { ok: true, ...(await mods.compatibleVersions(id)) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})
// Per-profile RAM override (MB); null clears it back to the global setting.
ipcMain.handle('profiles:setMemory', (_e, a: { id: string; mb: number | null }) => {
  store.setProfileMemory(a.id, a.mb ?? undefined)
  return { ok: true }
})
// Change a profile's Minecraft version: migrate its Modrinth mods to that version, then update the
// profile (which also forces a base-game re-install on next launch).
ipcMain.handle('profiles:setVersion', (_e, a: { id: string; mcVersion: string }) => {
  const p = store.getProfile(a.id)
  if (!p) return { ok: false, error: 'Profile not found' }
  // Fire-and-forget: the version change runs as a background install with progress in the sidebar,
  // so the settings dialog can close immediately instead of hanging on a long "Saving".
  backgroundVersionChange(p, a.mcVersion)
  return { ok: true }
})
// Repair a profile — currently removes duplicate mods left behind by a failed update/version change.
ipcMain.handle('profiles:repair', async (_e, id: string) => {
  try {
    return { ok: true, ...(await mods.repairProfile(id)) }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})
ipcMain.handle('profiles:delete', (_e, id: string) => {
  store.deleteProfile(id)
  return true
})
ipcMain.handle('profiles:reorder', (_e, orderedIds: string[]) => {
  store.reorderProfiles(orderedIds)
  return true
})
ipcMain.handle('profiles:openFolder', async (_e, id: string) => {
  await shell.openPath(store.instanceDir(id))
  return true
})
ipcMain.handle('content:openFolder', async (_e, a: { id: string; type: mods.ContentType }) => {
  await shell.openPath(mods.contentFolder(a.id, a.type))
  return true
})
ipcMain.handle('app:openUrl', async (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  return true
})

// Total system RAM in MB (for the memory slider max).
ipcMain.handle('system:totalRam', () => Math.floor(totalmem() / (1024 * 1024)))

// Discord Rich Presence.
ipcMain.handle('discord:activity', (_e, a: { profile?: string | null }) => {
  if (a.profile) discord.setActivity({ details: `Playing ${a.profile}`})
  else discord.setActivity({ details: 'Idling' })
  return true
})
ipcMain.handle('discord:enabled', (_e, v: boolean) => {
  discord.setEnabled(v)
  return true
})

// Custom window controls (the OS title bar is hidden — frame: false).
ipcMain.handle('window:minimize', () => win?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window:close', () => win?.close())

// ── versions ────────────────────────────────────────────────────────────────
ipcMain.handle('versions:list', (_e, showSnapshots: boolean) => listVersions(showSnapshots))
// MC versions a given loader supports (null = all, for vanilla).
ipcMain.handle('loaders:versions', (_e, loader: string) => loaders.supportedVersions(loader))
// Loader builds for a loader + MC version (Stable/Latest/Other picker in the New-profile dialog).
ipcMain.handle('loaders:builds', (_e, a: { loader: string; mcVersion: string }) => loaders.loaderBuilds(a.loader, a.mcVersion))

// ── launch ──────────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', async (_e, arg: string | { profileId: string; ignoreConflicts?: boolean }) => {
  // Back-compat: older callers passed a bare profileId string; the conflict modal passes an object
  // with ignoreConflicts:true to launch past a detected conflict ("launch anyway").
  const profileId = typeof arg === 'string' ? arg : arg.profileId
  const ignoreConflicts = typeof arg === 'string' ? false : !!arg.ignoreConflicts
  // Only one game at a time. Background downloads are fine, but don't let a second game start.
  if (child) {
    const msg = 'A game is already running — stop it first.'
    send('toast', { text: msg })
    return { ok: false, error: msg }
  }
  const profile = store.getProfile(profileId)
  if (!profile) return { ok: false, error: 'Profile not found' }
  try {
    const settings = store.getSettings()
    log.info('launch', `play pressed: "${profile.name}" (${profile.mcVersion} / ${profile.loader}${profile.loaderVersion ? ' ' + profile.loaderVersion : ''})`)

    // Fast path: if this profile is already installed and the cached files are still on disk
    // AND non-empty, launch straight away — no re-download/validation. The non-empty check
    // matters: a failed download can leave a 0-byte java.exe or version json, and launching
    // those fails ("spawn EFTYPE"). If anything looks off, fall through to a full (self-
    // healing) install instead.
    const nonEmpty = (p: string): boolean => {
      try {
        return statSync(p).size > 0
      } catch {
        return false
      }
    }
    const cachedJava = profile.javaPath && nonEmpty(profile.javaPath) ? profile.javaPath : ''
    const versionJson = profile.versionId
      ? join(store.sharedRoot(), 'versions', profile.versionId, `${profile.versionId}.json`)
      : ''
    let ready: { dir: string; versionId: string; java: string }
    if (profile.installed && profile.versionId && cachedJava && versionJson && nonEmpty(versionJson)) {
      log.info('launch', `using cached install (version ${profile.versionId})`)
      ready = { dir: store.instanceDir(profile.id), versionId: profile.versionId, java: cachedJava }
    } else {
      log.info('launch', 'no valid cached install — running installer before launch')
      pstate(profile.id, 'installing', 0, 'Preparing…')
      const logProg = phaseLogger('install', profile.name)
      ready = await installer.prepareInstall(profile, settings, (percent, text) => {
        logProg(percent, text)
        pstate(profile.id, 'installing', percent, text)
      })
      store.setInstallResult(profile.id, ready.versionId, ready.java)
      log.info('launch', `install ready → version ${ready.versionId}, java ${ready.java}`)
    }

    // Licensed sign-in: refresh the token (silently) right before launch so the game gets a
    // valid session. If the session can't be renewed the account is stale — sign out and stop,
    // rather than silently dropping to an offline session the user didn't ask for.
    let account: LaunchAccount | null = null
    const active = store.getActiveAccount()
    if (active?.type === 'msa') {
      try {
        const fresh = await auth.ensureValid(active)
        store.updateAccount(fresh)
        account = { name: fresh.name, licensed: true, uuid: fresh.id, accessToken: fresh.mcToken }
      } catch (e) {
        // Session can't be renewed (revoked/expired) — drop this account and stop, rather than
        // silently launching offline under a name the user thinks is licensed.
        store.removeAccount(active.id)
        send('authChanged', publicAccounts())
        const m = errMsg(e)
        pstate(profile.id, 'idle', 0, '')
        send('toast', { text: `Please sign in again — ${m}` })
        return { ok: false, error: m }
      }
    } else if (active?.type === 'offline') {
      account = { name: active.name, licensed: false }
    }

    // Pre-launch mod-compatibility gate (Fabric/Quilt): catch version-range conflicts like
    // Sodium↔Iris BEFORE the loader crashes on them. On a hit, surface the conflict modal and stop —
    // unless the user chose "launch anyway" from that modal (ignoreConflicts).
    if (!ignoreConflicts) {
      try {
        const conflicts = await modcompat.checkConflicts(profile.id)
        if (conflicts.length) {
          log.info('launch', `blocked by ${conflicts.length} mod conflict(s): "${profile.name}"`)
          send('modConflict', { profileId: profile.id, source: 'prelaunch', conflicts })
          pstate(profile.id, 'ready', 100, 'Ready')
          return { ok: false, error: 'mod-conflict' }
        }
      } catch (e) {
        // The check must never block a launch on its own bug — log and proceed.
        log.error('launch', `conflict check errored (ignored): ${errMsg(e)}`)
      }
    }

    pstate(profile.id, 'launching', 100, 'Launching…')
    crashBuf = ''
    child = await launchGame({ ...ready, settings, account, maxMemory: profile.maxMemory })
    const startedAt = Date.now()
    pstate(profile.id, 'running', 100, 'Running')
    log.info('game', `launched "${profile.name}" (${account?.licensed ? 'licensed' : 'offline'} as ${account?.name ?? '—'})`)
    // Discord shows the profile only while it's actually running (Idling otherwise). One line —
    // "Playing <profile>" — with the profile's own avatar as the image when it has a public URL
    // (modpack icons). Locally-picked avatars have no URL, so no image is shown for those.
    discord.setActivity({ details: `Playing ${profile.name}`, imageUrl: profile.avatarUrl, imageText: profile.name })
    // Game stdout/stderr → both the in-app console and the log file (crash reports live here).
    const capture = (s: string): void => {
      send('log', s)
      log.raw(s)
      // Keep a bounded tail for post-mortem crash parsing (Fabric prints the incompatibility block
      // near the end). 20k chars comfortably covers the FormattedException + its details.
      crashBuf = (crashBuf + s).slice(-20000)
    }
    child.stdout?.on('data', (d: Buffer) => capture(d.toString()))
    child.stderr?.on('data', (d: Buffer) => capture(d.toString()))
    child.on('exit', (code) => {
      store.addPlaytime(profile.id, Date.now() - startedAt)
      log.info('game', `"${profile.name}" exited with code ${code ?? 0}`)
      pstate(profile.id, 'ready', 100, `Closed (exit ${code ?? 0})`)
      send('profilesChanged', null) // playtime updated → let the UI re-read profiles
      discord.setActivity({ details: 'Idling' })
      // A non-zero exit that carries a Fabric mod-incompatibility crash → show the same conflict
      // modal, now with the loader's exact "remove this mod" verdict (a precise disable candidate).
      if (code) {
        const conflict = modcompat.parseFabricCrash(crashBuf)
        if (conflict) send('modConflict', { profileId: profile.id, source: 'crash', conflicts: [conflict] })
      }
      child = null
    })
    return { ok: true }
  } catch (e) {
    if (isCancelled(e)) {
      log.info('launch', `cancelled: "${profile.name}"`)
      pstate(profile.id, 'idle', 0, '')
      return { ok: false, error: 'cancelled' }
    }
    const msg = errMsg(e)
    log.error('launch', `failed: "${profile.name}" (${profile.mcVersion} / ${profile.loader}) — ${msg}`)
    pstate(profile.id, 'error', 0, 'Failed')
    send('toast', { text: msg || 'Launch failed' })
    return { ok: false, error: msg || 'launch failed' }
  }
})

// Cancel an in-flight install (Play/create download). The pending promise rejects with a
// cancelled marker, handled by the catch blocks above / in backgroundInstall.
ipcMain.handle('install:cancel', (_e, id: string) => {
  installer.cancelInstall(id)
  return true
})

ipcMain.handle('game:stop', () => {
  child?.kill()
  return true
})

// ── java ──────────────────────────────────────────────────────────────────
ipcMain.handle('java:detect', async (_e, major: number) => {
  const path = await detectJava(major)
  return { ok: !!path, path: path ?? undefined }
})

// Auto-detect: one scan for every slotable major (used on first run to fill empty slots).
ipcMain.handle('java:detectAll', async (_e, majors: number[]) => detectAllJava(majors))

ipcMain.handle('java:install', async (_e, major: number) => {
  try {
    const { path } = await installer.installJava(major, store.getSettings(), (percent, text) => {
      send('progress', { percent })
      send('status', { phase: 'install', text })
    })
    send('status', { phase: 'idle', text: `Java ${major} ready` })
    return { ok: true, path }
  } catch (e) {
    const m = errMsg(e)
    send('status', { phase: 'idle', text: 'Ready' })
    send('toast', { text: m })
    return { ok: false, error: m }
  }
})

// ── content: mods / resource packs / data packs / shaders (Modrinth + CurseForge) ─────────
ipcMain.handle(
  'content:search',
  async (
    _e,
    a: { query: string; mcVersion: string; loader: string; sort?: string; type: mods.ContentType; offset?: number; source?: mods.Source }
  ) => {
    try {
      // CurseForge is disabled for now — always search Modrinth. (a.source is kept in the wire
      // format so re-enabling CurseForge later needs no IPC change.)
      const r = await mods.searchModrinth(a.query, a.mcVersion, a.loader, a.sort, a.type, a.offset)
      return { ok: true, hits: r.hits, total: r.total }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

ipcMain.handle(
  'content:install',
  async (
    _e,
    a: {
      profileId: string
      id: string
      mcVersion: string
      loader: string
      type: mods.ContentType
      hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
      source?: mods.Source
    }
  ) => {
    try {
      const r = await mods.installContent(a.profileId, a.id, a.mcVersion, a.loader, a.type, a.hit, a.source)
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

ipcMain.handle('content:list', (_e, a: { profileId: string; type: mods.ContentType }) => mods.listContent(a.profileId, a.type))
ipcMain.handle('content:enrich', (_e, a: { profileId: string; type: mods.ContentType }) => mods.enrichContent(a.profileId, a.type))
ipcMain.handle('content:project', async (_e, a: string | { idOrSlug: string; source?: mods.Source }) => {
  try {
    // Back-compat: older callers pass a bare id string; newer ones pass { idOrSlug, source }.
    const idOrSlug = typeof a === 'string' ? a : a.idOrSlug
    const source = typeof a === 'string' ? 'modrinth' : a.source
    return { ok: true, project: await mods.getProject(idOrSlug, source) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('content:checkUpdates', (_e, a: { profileId: string; type: mods.ContentType }) => mods.checkUpdates(a.profileId, a.type))
ipcMain.handle('content:update', async (_e, a: { profileId: string; type: mods.ContentType; name: string }) => {
  try {
    return { ok: true, filename: await mods.updateContent(a.profileId, a.type, a.name) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('content:toggle', (_e, a: { profileId: string; type: mods.ContentType; name: string; enable: boolean }) => {
  mods.toggleContent(a.profileId, a.type, a.name, a.enable)
  return true
})
ipcMain.handle('content:remove', (_e, a: { profileId: string; type: mods.ContentType; name: string }) => {
  mods.removeContent(a.profileId, a.type, a.name)
  return true
})
ipcMain.handle('content:addFiles', (_e, a: { profileId: string; type: mods.ContentType; paths: string[] }) =>
  mods.addFiles(a.profileId, a.type, a.paths)
)

// ── dialogs ─────────────────────────────────────────────────────────────────
ipcMain.handle('dialog:pickJava', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Select the java(w) executable' })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:pickModpack', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Import a modpack',
    filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }]
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('modpack:import', async (_e, filePath: string) => {
  try {
    const info = await modpack.readModpack(filePath)
    const p = store.addProfile(info.name, info.mcVersion, info.loader)
    backgroundImport(p, filePath)
    return { ok: true, id: p.id }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})

// Browse Modrinth modpacks from the New-profile dialog (version/loader-agnostic search).
ipcMain.handle('modpack:search', async (_e, a: { query: string; sort?: string; offset?: number }) => {
  try {
    const r = await mods.searchModpacks(a.query, a.sort, a.offset)
    return { ok: true, hits: r.hits, total: r.total }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})

// Create a profile from a chosen Modrinth modpack: download its latest .mrpack, then import it
// through the exact same path as a local .mrpack (readModpack → addProfile → backgroundImport).
ipcMain.handle('modpack:importFromModrinth', async (_e, a: { projectId: string; iconUrl?: string }) => {
  try {
    const filePath = await mods.downloadModpackToTemp(a.projectId)
    const info = await modpack.readModpack(filePath)
    const p = store.addProfile(info.name, info.mcVersion, info.loader)
    // Use the modpack's Modrinth icon as the profile avatar so imported packs aren't left with a
    // blank/generated one. Best-effort — a failed icon download just falls back to the default.
    if (a.iconUrl) await saveProfileAvatarFromUrl(p.id, a.iconUrl)
    backgroundImport(p, filePath)
    return { ok: true, id: p.id }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
})

ipcMain.handle('dialog:pickImage', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Select an avatar image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
  })
  return r.canceled ? null : r.filePaths[0]
})

// Copy arbitrary text to the OS clipboard (used by the error toast → click to copy).
ipcMain.handle('clipboard:write', (_e, text: string) => {
  clipboard.writeText(String(text ?? ''))
  return true
})

ipcMain.handle('image:dataUrl', (_e, p: string) => {
  try {
    const ext = extname(p).slice(1).toLowerCase() || 'png'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
})
