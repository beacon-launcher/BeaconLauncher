import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { getVersionList } from '@xmcl/installer'
import { launch } from '@xmcl/core'
import type { Settings } from './store'
import { sharedRoot } from './store'

// The heavy work (downloading Minecraft + loader + Java) lives in the installer
// utilityProcess (installer-worker.ts) so it never blocks the main thread. This module
// only keeps the two light bits that must stay in the main process: the cached version
// list for the UI, and spawning the game once everything is already on disk.

let cachedList: Awaited<ReturnType<typeof getVersionList>> | null = null

async function versionList(): Promise<Awaited<ReturnType<typeof getVersionList>>> {
  if (!cachedList) cachedList = await getVersionList()
  return cachedList
}

export async function listVersions(showSnapshots: boolean): Promise<{ id: string; type: string }[]> {
  const list = await versionList()
  return list.versions.filter((v) => showSnapshots || v.type === 'release').map((v) => ({ id: v.id, type: v.type }))
}

// Offline account: a stable UUID derived from the name, exactly how a vanilla server
// assigns one to an offline/cracked player. No Microsoft login anywhere.
function offlineUuid(name: string): string {
  const h = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

/** The active account resolved to just what the launch needs. */
export interface LaunchAccount {
  name: string
  licensed: boolean
  uuid?: string // licensed only (from the Minecraft profile)
  accessToken?: string // licensed only
}

/** Spawn the game. Everything it needs is already installed by the worker at this point. */
export async function launchGame(opts: {
  dir: string
  versionId: string
  java: string
  settings: Settings
  account?: LaunchAccount | null
  maxMemory?: number // per-profile override; falls back to the global setting
}): Promise<ChildProcess> {
  const { dir, versionId, java, settings, account } = opts
  // Name comes from the active account; fall back to the settings username if there's none.
  const name = (account?.name || settings.username || 'Player').trim() || 'Player'
  const licensed = !!(account?.licensed && account.uuid && account.accessToken)
  const child = await launch({
    gamePath: dir,
    resourcePath: sharedRoot(),
    javaPath: java,
    version: versionId,
    gameProfile: licensed ? { id: account!.uuid!, name } : { id: offlineUuid(name), name },
    accessToken: licensed ? account!.accessToken! : '0',
    // 'msa' is what modern clients expect for a Microsoft session; @xmcl's types predate it,
    // so cast. Offline stays 'mojang' as before.
    userType: (licensed ? 'msa' : 'mojang') as 'mojang',
    maxMemory: Math.max(512, Math.floor(opts.maxMemory || settings.maxMemory) || 2048),
    // Detach the game so it outlives the launcher. On Windows, Electron puts child processes in a
    // Job Object that is killed when the app quits — `detached` breaks the game out of that job so
    // closing the launcher no longer closes Minecraft. `unref()` (below) then lets the launcher's
    // event loop exit without waiting on the game.
    extraExecOption: { detached: true }
  })
  child.unref()
  return child
}
