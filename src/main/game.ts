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

/** Spawn the game. Everything it needs is already installed by the worker at this point. */
export function launchGame(opts: { dir: string; versionId: string; java: string; settings: Settings }): Promise<ChildProcess> {
  const { dir, versionId, java, settings } = opts
  const name = (settings.username || 'Player').trim() || 'Player'
  return launch({
    gamePath: dir,
    resourcePath: sharedRoot(),
    javaPath: java,
    version: versionId,
    gameProfile: { id: offlineUuid(name), name },
    accessToken: '0',
    userType: 'mojang',
    maxMemory: Math.max(512, Math.floor(settings.maxMemory) || 2048)
  })
}
