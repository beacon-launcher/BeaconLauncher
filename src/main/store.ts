import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'neoforge' | 'forge'

export interface Settings {
  username: string
  maxMemory: number
  accentColor: string
  discordRpc: boolean
  // Optional manual overrides per Java major (empty = auto-download the one the version needs).
  java8: string
  java17: string
  java21: string
  java25: string
}

export interface Profile {
  id: string
  name: string
  mcVersion: string
  loader: Loader
  // Specific loader build to install (Fabric/Quilt loader version, Forge/NeoForge build).
  // Empty/undefined = let the installer pick the stable/recommended one.
  loaderVersion?: string
  created: number
  installed?: boolean
  // Cached after a successful install so pressing Play can launch straight away instead of
  // re-running the whole download+validation. `versionId` is the resolved (possibly modded)
  // version to launch; `javaPath` is the JRE that was used.
  versionId?: string
  javaPath?: string
  playtimeMs?: number // total time the game has been running for this profile
  dir: string
  avatar?: string // absolute path to a custom avatar image; empty = generated identicon
}

const dataDir = (): string => app.getPath('userData')
const settingsFile = (): string => join(dataDir(), 'settings.json')
const profilesFile = (): string => join(dataDir(), 'profiles.json')

// Shared game files (versions / libraries / assets) live here and are reused by every profile,
// so the same Minecraft version is only ever downloaded once.
export const sharedRoot = (): string => join(dataDir(), 'shared')
// Per-profile instances (saves / mods / config / options) — one readable folder per profile name.
export const profilesRoot = (): string => join(dataDir(), 'profiles')
export const avatarsRoot = (): string => join(dataDir(), 'avatars')
export const instanceDir = (id: string): string => join(profilesRoot(), getProfile(id)?.dir ?? id)

const DEFAULT_SETTINGS: Settings = { username: 'Player', maxMemory: 2048, accentColor: '#ffffff', discordRpc: true, java8: '', java17: '', java21: '', java25: '' }

export function getSettings(): Settings {
  try {
    if (existsSync(settingsFile())) return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), 'utf-8')) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: Settings): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
  } catch {
    /* ignore */
  }
}

export function getProfiles(): Profile[] {
  try {
    if (existsSync(profilesFile())) return JSON.parse(readFileSync(profilesFile(), 'utf-8'))
  } catch {
    /* ignore */
  }
  return []
}

function saveProfiles(p: Profile[]): void {
  try {
    writeFileSync(profilesFile(), JSON.stringify(p, null, 2))
  } catch {
    /* ignore */
  }
}

export function getProfile(id: string): Profile | undefined {
  return getProfiles().find((p) => p.id === id)
}

function uniqueDir(name: string, existing: Profile[]): string {
  const base = name.replace(/[<>:"/\|?*]+/g, '').replace(/\s+/g, ' ').trim() || 'Profile'
  const taken = new Set(existing.map((p) => (p.dir ?? '').toLowerCase()))
  let candidate = base
  let n = 2
  while (taken.has(candidate.toLowerCase()) || existsSync(join(profilesRoot(), candidate))) {
    candidate = `${base} (${n++})`
  }
  return candidate
}

export function addProfile(name: string, mcVersion: string, loader: Loader, loaderVersion?: string): Profile {
  const all = getProfiles()
  const finalName = name.trim() || `Profile ${all.length + 1}`
  const dir = uniqueDir(finalName, all)
  const p: Profile = { id: randomUUID(), name: finalName, mcVersion, loader, loaderVersion: loaderVersion || undefined, created: Date.now(), installed: false, dir }
  all.push(p)
  saveProfiles(all)
  mkdirSync(instanceDir(p.id), { recursive: true })
  return p
}

export function setAvatar(id: string, avatar: string | undefined): void {
  const all = getProfiles()
  const p = all.find((x) => x.id === id)
  if (p) {
    p.avatar = avatar
    saveProfiles(all)
  }
}

export function setInstalled(id: string, value: boolean): void {
  const all = getProfiles()
  const p = all.find((x) => x.id === id)
  if (p) {
    p.installed = value
    saveProfiles(all)
  }
}

// Record the resolved launch info after a successful install (enables Play's fast path).
export function setInstallResult(id: string, versionId: string, javaPath: string): void {
  const all = getProfiles()
  const p = all.find((x) => x.id === id)
  if (p) {
    p.installed = true
    p.versionId = versionId
    p.javaPath = javaPath
    saveProfiles(all)
  }
}

// Add a finished play session's duration to the profile's total.
export function addPlaytime(id: string, ms: number): void {
  if (!(ms > 0)) return
  const all = getProfiles()
  const p = all.find((x) => x.id === id)
  if (p) {
    p.playtimeMs = (p.playtimeMs ?? 0) + ms
    saveProfiles(all)
  }
}

export function reorderProfiles(orderedIds: string[]): void {
  const all = getProfiles()
  const byId = new Map(all.map((p) => [p.id, p]))
  const next = orderedIds.map((id) => byId.get(id)).filter((p): p is Profile => !!p)
  // Append any profiles missing from the given order (safety).
  for (const p of all) if (!orderedIds.includes(p.id)) next.push(p)
  saveProfiles(next)
}

export function renameProfile(id: string, name: string): void {
  const all = getProfiles()
  const p = all.find((x) => x.id === id)
  if (!p) return
  p.name = name.trim() || p.name
  saveProfiles(all)
}

export function deleteProfile(id: string): void {
  const dir = instanceDir(id) // resolve the folder BEFORE removing the profile from the list
  saveProfiles(getProfiles().filter((p) => p.id !== id))
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
