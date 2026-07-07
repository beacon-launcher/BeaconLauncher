import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { Profile, Settings } from './store'

// Main-side handle to the installer utilityProcess (see installer-worker.ts). It spawns
// the worker lazily, reuses it across jobs, buffers messages until the child is ready,
// and turns each job into a promise while relaying progress callbacks.

type OnProgress = (percent: number, text: string) => void
type Pending = { onProgress: OnProgress; resolve: (v: unknown) => void; reject: (e: Error) => void }

let child: UtilityProcess | null = null
let ready = false
let outbox: unknown[] = []
let seq = 0
const pending = new Map<number, Pending>()

function ensureChild(): UtilityProcess {
  if (child) return child
  ready = false
  outbox = []
  const c = utilityProcess.fork(join(__dirname, 'installer-worker.js'), [], { serviceName: 'beacon-installer' })
  child = c
  c.on('spawn', () => {
    ready = true
    for (const m of outbox) c.postMessage(m)
    outbox = []
  })
  c.on('message', (msg: { kind: string; id: number; percent?: number; text?: string; result?: unknown; message?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.kind === 'progress') p.onProgress(msg.percent ?? 0, msg.text ?? '')
    else if (msg.kind === 'done') {
      pending.delete(msg.id)
      p.resolve(msg.result)
    } else if (msg.kind === 'error') {
      pending.delete(msg.id)
      p.reject(new Error(msg.message || 'Install failed'))
    } else if (msg.kind === 'cancelled') {
      pending.delete(msg.id)
      p.reject(Object.assign(new Error('Install cancelled'), { cancelled: true }))
    }
  })
  c.on('exit', () => {
    child = null
    ready = false
    const err = new Error('Installer process stopped unexpectedly')
    for (const [, p] of pending) p.reject(err)
    pending.clear()
  })
  return c
}

function run<T>(job: Record<string, unknown>, onProgress: OnProgress): Promise<T> {
  const c = ensureChild()
  const id = ++seq
  const msg = { ...job, id }
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { onProgress, resolve: resolve as (v: unknown) => void, reject })
    if (ready) c.postMessage(msg)
    else outbox.push(msg)
  })
}

type PrepareResult = { dir: string; versionId: string; java: string }
// One install per profile at a time. Creating a profile kicks off a background install; if
// the user then presses Play, we must NOT start a second concurrent install of the same
// shared files (they'd corrupt each other). Instead we reuse the running one, fan its
// progress out to every caller (sidebar + status bar), and remember the worker job id so it
// can be cancelled.
const inflight = new Map<string, { promise: Promise<PrepareResult>; listeners: OnProgress[]; jobId: number }>()

// Shared dispatch: dedupe per profile, fan progress out to every caller, remember the job id.
function startJob(profile: Profile, onProgress: OnProgress, makeMsg: (jobId: number) => Record<string, unknown>): Promise<PrepareResult> {
  const existing = inflight.get(profile.id)
  if (existing) {
    existing.listeners.push(onProgress)
    return existing.promise
  }
  const listeners: OnProgress[] = [onProgress]
  const fanout: OnProgress = (percent, text) => {
    for (const l of listeners) l(percent, text)
  }
  const c = ensureChild()
  const jobId = ++seq
  const msg = makeMsg(jobId)
  const promise = new Promise<PrepareResult>((resolve, reject) => {
    pending.set(jobId, { onProgress: fanout, resolve: resolve as (v: unknown) => void, reject })
    if (ready) c.postMessage(msg)
    else outbox.push(msg)
  }).finally(() => inflight.delete(profile.id))
  inflight.set(profile.id, { promise, listeners, jobId })
  return promise
}

const slim = (p: Profile): object => ({ id: p.id, mcVersion: p.mcVersion, loader: p.loader, loaderVersion: p.loaderVersion, dir: p.dir })

/** Download everything a profile needs (Minecraft + loader + Java), off the main thread. */
export function prepareInstall(profile: Profile, settings: Settings, onProgress: OnProgress): Promise<PrepareResult> {
  return startJob(profile, onProgress, (id) => ({ kind: 'prepare', profile: slim(profile), settings, userData: app.getPath('userData'), id }))
}

/** Import a Modrinth modpack (.mrpack) into a profile — mods + config, then the base install. */
export function importModpack(profile: Profile, settings: Settings, filePath: string, onProgress: OnProgress): Promise<PrepareResult> {
  return startJob(profile, onProgress, (id) => ({
    kind: 'importModpack',
    profile: slim(profile),
    settings,
    filePath,
    userData: app.getPath('userData'),
    id
  }))
}

/** Cancel an in-flight install for a profile (no-op if nothing is running). */
export function cancelInstall(profileId: string): void {
  const e = inflight.get(profileId)
  if (e && child) child.postMessage({ kind: 'cancel', id: e.jobId })
}

/** Download a specific Java major (Settings → "Install"), off the main thread. */
export function installJava(major: number, settings: Settings, onProgress: OnProgress): Promise<{ path: string }> {
  return run({ kind: 'installJava', major, settings, userData: app.getPath('userData') }, onProgress)
}
