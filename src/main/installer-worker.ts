// Runs in an Electron utilityProcess — a plain Node context with NO access to the
// `app`/`BrowserWindow` APIs. ALL the heavy lifting (downloading the client jar,
// libraries, thousands of asset files, verifying their SHA1 hashes, and fetching the
// Java runtime) happens here instead of the main process, so the window and UI stay
// smooth while a version installs. The main process only feeds it jobs and relays the
// progress/result messages it posts back.
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, statSync, writeFileSync, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Agent, setGlobalDispatcher } from 'undici'
import {
  getVersionList,
  installVersionTask,
  installFabric,
  getLoaderArtifactListFor,
  installQuiltVersion,
  installDependenciesTask,
  installForgeTask,
  getForgeVersionList,
  installNeoForgedTask,
  fetchJavaRuntimeManifest,
  installJavaRuntimeTask
} from '@xmcl/installer'
import { open as openZip, readAllEntries, readEntry, openEntryReadStream } from '@xmcl/unzip'
import { Version } from '@xmcl/core'

// Tuned for flaky links to Mojang's CDNs. A *short* connect timeout matters most: when the
// CDN drops a TLS handshake (the "socket disconnected before secure TLS" error), we want to
// fail fast and retry on a fresh connection rather than hang for a minute. Capped connections
// keep the number of simultaneous handshakes low; no resume interceptor (Mojang's CDN breaks
// byte-range resumes → @xmcl re-downloads failed files whole).
const dispatcher = new Agent({
  connections: 4,
  connect: { timeout: 20_000 },
  headersTimeout: 120_000,
  bodyTimeout: 120_000
})
setGlobalDispatcher(dispatcher)

const RETRY = { maxRetryCount: 20 }

type Profile = { id: string; mcVersion: string; loader: string; loaderVersion?: string; dir: string }
type Settings = { username?: string; maxMemory?: number; java8?: string; java17?: string; java21?: string; java25?: string }

let cachedList: Awaited<ReturnType<typeof getVersionList>> | null = null
async function versionList(): Promise<Awaited<ReturnType<typeof getVersionList>>> {
  if (!cachedList) cachedList = await getVersionList()
  return cachedList
}

// Unwrap undici's AggregateError so the surfaced message names the real cause.
function errMsg(e: unknown): string {
  if (e instanceof AggregateError && Array.isArray(e.errors) && e.errors.length) {
    const inner = e.errors.map((x) => (x instanceof Error ? x.message : String(x))).filter(Boolean)
    // Dedupe — a flaky connection produces the same message hundreds of times.
    const uniq = [...new Set(inner)]
    if (uniq.length) return `${uniq.slice(0, 3).join(' · ')}${uniq.length > 3 ? ` (+${uniq.length - 3} more)` : ''}`
  }
  return e instanceof Error ? e.message || e.name : typeof e === 'string' ? e : JSON.stringify(e)
}

type OnProgress = (percent: number, text: string) => void
// A per-phase progress reporter: fraction is 0..1 within the current phase.
type Report = (fraction: number, text: string) => void

// Maps per-phase fractions onto one monotonic overall %. Each phase has a relative weight;
// completing a phase (even an instant, fully-cached one) advances the overall bar by its
// weight. This is what stops the bar reading "0%" the whole time when a version's assets are
// already on disk (Minecraft assets are shared by hash across versions → 0 bytes to download).
function makeAggregator(weights: number[], onProgress: OnProgress): { report: Report; next: () => void } {
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let idx = 0
  let done = 0
  return {
    report(fraction, text) {
      const w = weights[idx] ?? 1
      const f = Math.min(1, Math.max(0, fraction))
      onProgress(Math.min(100, Math.round(((done + f * w) / total) * 100)), text)
    },
    next() {
      done += weights[idx] ?? 0
      idx++
    }
  }
}

// The Mojang CDNs (libraries/resources.download.minecraft.net) intermittently drop TLS
// connections, leaving empty files that then fail their checksum. @xmcl retries each file,
// but on a flaky link that can still exhaust. Installing is idempotent (good files are
// skipped, only missing/corrupt ones re-download), so retrying the WHOLE operation a few
// times — each with fresh connections — reliably converges where per-file retries alone don't.
function isNetworkError(e: unknown): boolean {
  if (e instanceof AggregateError) return true
  const m = e instanceof Error ? e.message : String(e)
  return /socket|TLS|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|network|checksum|disconnect|fetch failed|terminated|reset/i.test(m)
}

// Cancellation: each job carries a Ctl that holds the currently-running @xmcl task so a
// 'cancel' message can abort it. Steps check `cancelled` between phases.
class Cancelled extends Error {}
type Ctl = { cancelled: boolean; current: { cancel: () => Promise<void> } | null }
// Run one install step (a single @xmcl task) with cancellation + progress tracking, and
// force a final 100% so the bar visibly completes even when cached files under-count bytes.
async function phase<T>(
  ctl: Ctl,
  task: { startAndWait(ctx: unknown): Promise<T>; cancel: () => Promise<void>; total: number; progress: number },
  label: string,
  report: Report
): Promise<T> {
  if (ctl.cancelled) throw new Cancelled()
  ctl.current = task
  try {
    const r = await task.startAndWait(tracker(() => task, label, report))
    report(1, `${label} ✓`)
    return r
  } finally {
    ctl.current = null
  }
}
const guard = (ctl: Ctl): void => {
  if (ctl.cancelled) throw new Cancelled()
}

async function withRetry<T>(run: () => Promise<T>, onProgress: OnProgress, ctl?: Ctl): Promise<T> {
  const MAX = 6
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      return await run()
    } catch (e) {
      lastErr = e
      if (ctl?.cancelled || e instanceof Cancelled) throw e
      if (!isNetworkError(e) || attempt === MAX) throw e
      onProgress(0, `Network issue — retrying (${attempt}/${MAX - 1})…`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw lastErr
}

const mb = (n: number): number => Math.max(0, Math.round(n / 1048576))

// Byte-progress reporter for any @xmcl task. Two problems it solves:
//  1. A task's `total` grows as its internal phases (jar → libraries → assets) are
//     enumerated, so a naive progress/total jumps ~60% then crashes to ~14%. We hold the
//     bar at 0 until `total` has settled (stopped growing for 600ms), then report a
//     forward-only percentage — it never goes backwards.
//  2. While the total is still settling (or a slow file is retrying), the MB counter in the
//     text keeps the user informed so nothing looks frozen.
// Emits at most ~7×/s.
function tracker(getTask: () => { total: number; progress: number }, label: string, report: Report): { onUpdate(): void } {
  let lastEmit = 0
  let stableTotal = -1
  let stableSince = 0
  let started = false
  let peak = 0
  return {
    onUpdate(): void {
      const now = Date.now()
      if (now - lastEmit < 150) return
      lastEmit = now
      const t = getTask()
      const total = t.total || 0
      const progress = t.progress || 0
      if (total !== stableTotal) {
        stableTotal = total
        stableSince = now
      }
      if (!started && total > 0 && now - stableSince >= 600) started = true
      const raw = started && total > 0 ? Math.min(1, progress / total) : 0
      peak = Math.max(peak, raw)
      // Show "N / M MB" only once bytes are actually flowing; cached files download 0 bytes.
      report(peak, progress > 0 ? `${label} — ${mb(progress)} / ${mb(total)} MB` : `${label}…`)
    }
  }
}

// ── Java ──────────────────────────────────────────────────────────────────────
const COMPONENT_FOR_MAJOR: Record<number, string> = {
  8: 'jre-legacy',
  16: 'java-runtime-alpha',
  17: 'java-runtime-gamma',
  21: 'java-runtime-delta',
  25: 'java-runtime-epsilon'
}

function javaExe(dest: string): string {
  // Windows: use javaw.exe (GUI subsystem, no console) rather than java.exe. Two reasons:
  //  • Discord's game detection matches Minecraft against `javaw.exe` (what the official + every
  //    major third-party launcher spawns) — run java.exe and Discord never registers the game, so
  //    the in-game overlay can't attach. See also preferJavaw() in game.ts for cached installs.
  //  • No stray console window on a detached launch. Piped stdout/stderr still work (the subsystem
  //    flag only governs whether a console is auto-allocated), so crash-log capture is unaffected.
  if (process.platform === 'win32') return join(dest, 'bin', 'javaw.exe')
  if (process.platform === 'darwin') return join(dest, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  return join(dest, 'bin', 'java')
}

function isRealExe(p: string): boolean {
  try {
    return statSync(p).size > 0
  } catch {
    return false
  }
}

async function downloadRuntime(javaRoot: string, component: string, label: string, report: Report, ctl: Ctl): Promise<string> {
  const dest = join(javaRoot, component)
  const exe = javaExe(dest)
  // Always run the install task rather than trusting existsSync(java.exe): a flaky link can
  // leave a truncated jvm.dll (or a 0-byte java.exe) that a plain existence check misses,
  // causing "spawn EFTYPE" at launch. The task checksums every file and re-downloads only the
  // bad/missing ones. lzma:true fetches the compressed variants (e.g. jvm.dll 3.9MB vs 14MB),
  // which get through unstable connections far more reliably.
  const manifest = await fetchJavaRuntimeManifest({ target: component, dispatcher })
  const task = installJavaRuntimeTask({ manifest, destination: dest, lzma: true, dispatcher, ...RETRY })
  await phase(ctl, task, label, report)
  if (!isRealExe(exe)) throw new Error('Java runtime did not install correctly (empty java executable) — check your connection and retry')
  return exe
}

function javaSlot(settings: Settings, major: number): string {
  const map: Record<number, string | undefined> = { 8: settings.java8, 17: settings.java17, 21: settings.java21, 25: settings.java25 }
  return map[major] ?? ''
}

// Map a Minecraft version to the NeoForge build prefix. Two eras:
//  • Legacy "1.x" scheme: NeoForge drops the "1." — MC 1.21.1 → "21.1.x", 1.21 → "21.0.x",
//    1.20.4 → "20.4.x". (The one-off 1.20.1 line lives under a separate `forge` artifact.)
//  • New "26.x" scheme (Minecraft dropped the leading "1."): NeoForge tags builds as
//    "<mc>.<build>", e.g. MC 26.2 → "26.2.0.x". Prefixing with `${mc}.` matches those and
//    keeps future versions working without code changes.
function neoForgePrefix(mcVersion: string): string {
  if (mcVersion.startsWith('1.')) {
    const parts = mcVersion.split('.')
    return `${parts[1]}.${parts[2] ?? '0'}.`
  }
  return `${mcVersion}.`
}

async function resolveNeoForge(mcVersion: string): Promise<{ project: 'forge' | 'neoforge'; version: string }> {
  const pickLatest = (list: string[], prefix: string): string | undefined => {
    const matches = list.filter((v) => v.startsWith(prefix))
    const stable = matches.filter((v) => !v.includes('-'))
    const pool = stable.length ? stable : matches
    return pool[pool.length - 1]
  }
  if (mcVersion === '1.20.1') {
    const r = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge')
    const list = r.ok ? ((await r.json()).versions as string[]) : []
    const version = pickLatest(list, '1.20.1-')
    if (!version) throw new Error('NeoForge is not available for Minecraft 1.20.1')
    return { project: 'forge', version }
  }
  const r = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')
  const list = r.ok ? ((await r.json()).versions as string[]) : []
  const version = pickLatest(list, neoForgePrefix(mcVersion))
  if (!version) throw new Error(`NeoForge is not available for Minecraft ${mcVersion}`)
  return { project: 'neoforge', version }
}

// ── Prepare (vanilla + loader + java) ──────────────────────────────────────────
async function prepare(
  profile: Profile,
  settings: Settings,
  userData: string,
  onProgress: OnProgress,
  ctl: Ctl
): Promise<{ dir: string; versionId: string; java: string }> {
  const shared = join(userData, 'shared')
  const javaRoot = join(userData, 'java')
  const dir = join(userData, 'profiles', profile.dir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(shared)) mkdirSync(shared, { recursive: true })

  const list = await versionList()
  const meta = list.versions.find((v) => v.id === profile.mcVersion)
  if (!meta) throw new Error(`Version ${profile.mcVersion} not found in the manifest`)

  // One monotonic overall bar across every phase (relative weights per loader). Completing a
  // phase advances the bar even if its files were already cached — so it never sits at 0%.
  const loader = profile.loader
  const weights =
    loader === 'vanilla'
      ? [8, 55, 22]
      : loader === 'forge' || loader === 'neoforge'
        ? [8, 46, 18, 18, 10]
        : [8, 55, 20, 2, 15] // fabric / quilt
  const agg = makeAggregator(weights, onProgress)

  // 1) Vanilla base — small client json+jar, then the big libraries+assets (separate tasks so
  //    a ballooning `total` can't make the % lurch).
  const vt = installVersionTask(meta, shared, { dispatcher, ...RETRY })
  const baseResolved = await phase(ctl, vt, `Downloading ${profile.mcVersion}`, agg.report)
  agg.next()
  const dt = installDependenciesTask(baseResolved, { dispatcher, assetsDownloadConcurrency: 3, librariesDownloadConcurrency: 3, ...RETRY })
  await phase(ctl, dt, 'Downloading assets', agg.report)
  agg.next()

  let versionId = profile.mcVersion

  // 2) Java — before the loader (Forge/NeoForge processors need a JRE); major fixed by the MC version.
  guard(ctl)
  const jv = baseResolved.javaVersion ?? { component: 'jre-legacy', majorVersion: 8 }
  const slot = javaSlot(settings, jv.majorVersion)
  let java: string
  if (slot && existsSync(slot)) {
    java = slot
    agg.report(1, 'Java ready')
  } else {
    java = await downloadRuntime(javaRoot, jv.component, `Downloading Java ${jv.majorVersion}`, agg.report, ctl)
  }
  agg.next()

  // 3) Mod loader.
  guard(ctl)
  // An explicit loader build chosen in the New-profile dialog (Latest / Other) pins the version;
  // empty means "let the installer pick the stable/recommended one" (the default).
  const pinned = profile.loaderVersion || ''
  if (loader === 'fabric') {
    agg.report(0, 'Installing Fabric…')
    let version = pinned
    if (!version) {
      const loaders = await getLoaderArtifactListFor(profile.mcVersion)
      const chosen = loaders.find((l) => l.loader.stable) ?? loaders[0]
      if (!chosen) throw new Error(`Fabric is not available for Minecraft ${profile.mcVersion}`)
      version = chosen.loader.version
    }
    versionId = await installFabric({ minecraftVersion: profile.mcVersion, version, minecraft: shared })
    agg.report(1, 'Fabric ✓')
    agg.next()
  } else if (loader === 'quilt') {
    agg.report(0, 'Installing Quilt…')
    let version = pinned
    if (!version) {
      const res = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${profile.mcVersion}`)
      const qlist = res.ok ? ((await res.json()) as any[]) : []
      if (!qlist.length) throw new Error(`Quilt is not available for Minecraft ${profile.mcVersion}`)
      version = qlist[0].loader.version
    }
    versionId = await installQuiltVersion({ minecraftVersion: profile.mcVersion, version, minecraft: shared })
    agg.report(1, 'Quilt ✓')
    agg.next()
  } else if (loader === 'forge') {
    agg.report(0, 'Installing Forge…')
    let version = pinned
    if (!version) {
      const fl = await getForgeVersionList({ minecraft: profile.mcVersion, dispatcher })
      const flist = fl.versions || []
      const chosen = flist.find((v) => v.type === 'recommended') ?? flist.find((v) => v.type === 'latest') ?? flist[0]
      if (!chosen) throw new Error(`Forge is not available for Minecraft ${profile.mcVersion}`)
      version = chosen.version
    }
    const ft = installForgeTask({ mcversion: profile.mcVersion, version }, shared, { dispatcher, java, ...RETRY })
    versionId = await phase(ctl, ft, 'Installing Forge', agg.report)
    agg.next()
  } else if (loader === 'neoforge') {
    agg.report(0, 'Installing NeoForge…')
    const resolved = await resolveNeoForge(profile.mcVersion)
    const version = pinned || resolved.version
    const nt = installNeoForgedTask(resolved.project, version, shared, { dispatcher, java, ...RETRY })
    versionId = await phase(ctl, nt, 'Installing NeoForge', agg.report)
    agg.next()
  }

  // 4) Remaining loader libraries.
  if (loader !== 'vanilla') {
    guard(ctl)
    const resolved = await Version.parse(shared, versionId)
    const dt2 = installDependenciesTask(resolved, { dispatcher, assetsDownloadConcurrency: 3, librariesDownloadConcurrency: 3, ...RETRY })
    await phase(ctl, dt2, 'Downloading libraries', agg.report)
    agg.next()
  }

  return { dir, versionId, java }
}

// ── Modpack import (.mrpack) ────────────────────────────────────────────────────
async function fetchToFile(url: string, dest: string): Promise<void> {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      return
    } catch (e) {
      if (a === 4) throw e
      await new Promise((r) => setTimeout(r, 1000 * a))
    }
  }
}

// Keep an extracted path inside the instance dir (guard against ../ traversal in a pack).
function safeJoin(base: string, rel: string): string | null {
  const p = join(base, rel)
  return p === base || p.startsWith(base + '\\') || p.startsWith(base + '/') ? p : null
}

async function importModpack(
  profile: Profile,
  settings: Settings,
  filePath: string,
  userData: string,
  onProgress: OnProgress,
  ctl: Ctl
): Promise<{ dir: string; versionId: string; java: string }> {
  const dir = join(userData, 'profiles', profile.dir)
  mkdirSync(dir, { recursive: true })
  onProgress(1, 'Reading modpack…')

  const zip = await openZip(filePath)
  let files: { path: string; downloads: string[]; fileSize?: number; env?: { client?: string } }[]
  try {
    const entries = await readAllEntries(zip)
    const indexEntry = entries.find((e) => e.fileName === 'modrinth.index.json')
    if (!indexEntry) throw new Error('modrinth.index.json missing')
    const index = JSON.parse((await readEntry(zip, indexEntry)).toString('utf-8'))
    files = ((index.files || []) as typeof files).filter((f) => f.env?.client !== 'unsupported' && f.downloads?.length)

    // Drop the pack's config overrides into the instance.
    onProgress(2, 'Applying config…')
    const overrides = entries.filter(
      (e) => !e.fileName.endsWith('/') && (e.fileName.startsWith('overrides/') || e.fileName.startsWith('client-overrides/'))
    )
    for (const e of overrides) {
      if (ctl.cancelled) throw new Cancelled()
      const rel = e.fileName.replace(/^client-overrides\//, '').replace(/^overrides\//, '')
      const dest = safeJoin(dir, rel)
      if (!dest) continue
      mkdirSync(dirname(dest), { recursive: true })
      await pipeline(await openEntryReadStream(zip, e), createWriteStream(dest))
    }
  } finally {
    zip.close()
  }

  // Download the pack's mods (first ~40% of the overall bar).
  const totalBytes = files.reduce((a, f) => a + (f.fileSize || 0), 0) || 1
  let doneBytes = 0
  for (const f of files) {
    if (ctl.cancelled) throw new Cancelled()
    const dest = safeJoin(dir, f.path)
    if (!dest) continue
    mkdirSync(dirname(dest), { recursive: true })
    if (!existsSync(dest) || (f.fileSize && statSync(dest).size !== f.fileSize)) {
      await fetchToFile(f.downloads[0], dest)
    }
    doneBytes += f.fileSize || 0
    onProgress(Math.min(40, Math.round((doneBytes / totalBytes) * 40)), `Downloading mods — ${mb(doneBytes)} / ${mb(totalBytes)} MB`)
  }

  // Install the vanilla + loader + java base (remaining ~60%).
  return prepare(profile, settings, userData, (pct, text) => onProgress(40 + Math.round(pct * 0.6), text), ctl)
}

// ── Message loop ────────────────────────────────────────────────────────────────
type Job =
  | { kind: 'prepare'; id: number; profile: Profile; settings: Settings; userData: string }
  | { kind: 'importModpack'; id: number; profile: Profile; settings: Settings; filePath: string; userData: string }
  | { kind: 'installJava'; id: number; major: number; settings: Settings; userData: string }
  | { kind: 'cancel'; id: number }

const port = process.parentPort
const jobs = new Map<number, Ctl>()

port.on('message', async (e) => {
  const job = e.data as Job
  if (job.kind === 'cancel') {
    const ctl = jobs.get(job.id)
    if (ctl) {
      ctl.cancelled = true
      ctl.current?.cancel().catch(() => {})
    }
    return
  }
  const onProgress: OnProgress = (percent, text) => port.postMessage({ kind: 'progress', id: job.id, percent, text })
  const ctl: Ctl = { cancelled: false, current: null }
  jobs.set(job.id, ctl)
  try {
    if (job.kind === 'prepare') {
      const result = await withRetry(() => prepare(job.profile, job.settings, job.userData, onProgress, ctl), onProgress, ctl)
      port.postMessage({ kind: 'done', id: job.id, result })
    } else if (job.kind === 'importModpack') {
      const result = await withRetry(() => importModpack(job.profile, job.settings, job.filePath, job.userData, onProgress, ctl), onProgress, ctl)
      port.postMessage({ kind: 'done', id: job.id, result })
    } else if (job.kind === 'installJava') {
      const component = COMPONENT_FOR_MAJOR[job.major]
      if (!component) throw new Error(`No Mojang runtime available for Java ${job.major}`)
      const javaRoot = join(job.userData, 'java')
      const report: Report = (f, t) => onProgress(Math.round(f * 100), t)
      const path = await withRetry(() => downloadRuntime(javaRoot, component, `Downloading Java ${job.major}`, report, ctl), onProgress, ctl)
      port.postMessage({ kind: 'done', id: job.id, result: { path } })
    }
  } catch (err) {
    if (ctl.cancelled || err instanceof Cancelled) port.postMessage({ kind: 'cancelled', id: job.id })
    else port.postMessage({ kind: 'error', id: job.id, message: errMsg(err) })
  } finally {
    jobs.delete(job.id)
  }
})
