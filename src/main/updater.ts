import { app, shell, type BrowserWindow } from 'electron'
import updater from 'electron-updater'

// Auto-update via GitHub Releases (config in electron-builder.yml → publish: github).
// Flow: check → (available) download on demand → (downloaded) quit & install.
//
// Unsigned macOS builds cannot self-apply an update (Squirrel.Mac requires a signed app),
// so on macOS we detect the new version and open the Releases page for a manual download
// instead of silently failing. Windows (NSIS) and Linux (AppImage) update in place.

const { autoUpdater } = updater
const RELEASES_URL = 'https://github.com/beacon-launcher/BeaconLauncher/releases/latest'
const isMac = process.platform === 'darwin'

export type UpdateState = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'
export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
  /** macOS unsigned: the update must be downloaded manually from the Releases page. */
  manual?: boolean
}

let win: BrowserWindow | null = null
let downloaded = false

function send(status: UpdateStatus): void {
  win?.webContents.send('updateStatus', status)
}

export function initUpdater(window: BrowserWindow): void {
  win = window
  autoUpdater.autoDownload = false // wait for the user to press "Update"
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version, manual: isMac }))
  autoUpdater.on('update-not-available', (info) => send({ state: 'none', version: info.version }))
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message || String(err) }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true
    send({ state: 'ready', version: info.version })
  })

  // A quiet check shortly after launch (packaged builds only — dev has no update feed).
  if (app.isPackaged) setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 4000)
}

export async function checkForUpdate(): Promise<{ ok: boolean; dev?: boolean; error?: string }> {
  if (!app.isPackaged) return { ok: false, dev: true }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function downloadUpdate(): Promise<{ ok: boolean; manual?: boolean; error?: string }> {
  // Unsigned macOS can't install a downloaded update — send the user to the Releases page.
  if (isMac) {
    await shell.openExternal(RELEASES_URL)
    return { ok: true, manual: true }
  }
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function quitAndInstall(): { ok: boolean } {
  if (!downloaded) return { ok: false }
  // isSilent=false so the installer UI shows; isForceRunAfter=true to relaunch.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return { ok: true }
}
