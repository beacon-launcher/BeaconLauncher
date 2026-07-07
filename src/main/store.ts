import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'neoforge' | 'forge'

export interface Settings {
  username: string
  maxMemory: number
  accentColor: string
  theme: 'system' | 'dark' | 'light'
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

// A launcher account. Either an offline nickname (cracked-style, no auth) or a licensed
// Microsoft account with real tokens. Both live in the same list so the user can freely add
// several of each and switch between them.
export interface Account {
  id: string // stable key: MC UUID for msa, random UUID for offline
  name: string // username shown / passed to the game
  type: 'offline' | 'msa'
  // msa only:
  msRefresh?: string // Microsoft OAuth refresh token — encrypted at rest
  mcToken?: string // current Minecraft access token (short-lived)
  mcExpiresAt?: number // epoch ms when mcToken stops being valid
}

const dataDir = (): string => app.getPath('userData')
const settingsFile = (): string => join(dataDir(), 'settings.json')
const profilesFile = (): string => join(dataDir(), 'profiles.json')
const accountsFile = (): string => join(dataDir(), 'accounts.json')
const legacyAccountFile = (): string => join(dataDir(), 'account.json') // pre-multi-account single file

// Shared game files (versions / libraries / assets) live here and are reused by every profile,
// so the same Minecraft version is only ever downloaded once.
export const sharedRoot = (): string => join(dataDir(), 'shared')
// Per-profile instances (saves / mods / config / options) — one readable folder per profile name.
export const profilesRoot = (): string => join(dataDir(), 'profiles')
export const avatarsRoot = (): string => join(dataDir(), 'avatars')
export const instanceDir = (id: string): string => join(profilesRoot(), getProfile(id)?.dir ?? id)

const DEFAULT_SETTINGS: Settings = { username: 'Player', maxMemory: 2048, accentColor: '#ffffff', theme: 'system', discordRpc: true, java8: '', java17: '', java21: '', java25: '' }

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

// The refresh token is the only long-lived secret here, so it's encrypted with the OS
// keychain (DPAPI / Keychain / libsecret) when available. If encryption isn't available
// (e.g. a headless Linux box with no keyring), fall back to plaintext so sign-in still works.
function encrypt(s: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64')
  } catch {
    /* ignore */
  }
  return 'raw:' + s
}
function decrypt(s: string): string {
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
  if (s.startsWith('raw:')) return s.slice(4)
  return s // legacy/plain
}

// Multiple signed-in accounts plus which one is active. activeId === null means offline
// (play with Settings.username). Persisted with each account's refresh token encrypted.
export interface AccountsState {
  accounts: Account[]
  activeId: string | null
}

// msRefresh is the only secret and only exists on msa accounts; (de)crypt it when present.
const readAcc = (a: Account): Account => (a.msRefresh ? { ...a, msRefresh: decrypt(a.msRefresh) } : a)
const writeAcc = (a: Account): Account => (a.msRefresh ? { ...a, msRefresh: encrypt(a.msRefresh) } : a)

function readAccountsFile(): AccountsState {
  try {
    // Migrate the old single (msa) account file into the new array on first read.
    if (!existsSync(accountsFile()) && existsSync(legacyAccountFile())) {
      const a = JSON.parse(readFileSync(legacyAccountFile(), 'utf-8')) as Account
      const migrated: AccountsState = { accounts: [{ ...readAcc(a), type: 'msa' }], activeId: a.id }
      writeAccountsFile(migrated)
      rmSync(legacyAccountFile(), { force: true })
      return migrated
    }
    if (existsSync(accountsFile())) {
      const raw = JSON.parse(readFileSync(accountsFile(), 'utf-8')) as AccountsState
      const accounts = (raw.accounts ?? []).map(readAcc)
      const activeId = accounts.some((a) => a.id === raw.activeId) ? raw.activeId : null
      return { accounts, activeId }
    }
    // First ever run: seed one offline account from the existing username so the bar isn't empty.
    const name = (getSettings().username || 'Player').trim() || 'Player'
    const seeded: AccountsState = { accounts: [{ id: randomUUID(), name, type: 'offline' }], activeId: null }
    seeded.activeId = seeded.accounts[0].id
    writeAccountsFile(seeded)
    return seeded
  } catch {
    return { accounts: [], activeId: null }
  }
}

function writeAccountsFile(state: AccountsState): void {
  try {
    writeFileSync(accountsFile(), JSON.stringify({ accounts: state.accounts.map(writeAcc), activeId: state.activeId }, null, 2))
  } catch {
    /* ignore */
  }
}

export function getAccounts(): AccountsState {
  return readAccountsFile()
}

/** The active account (offline or licensed), or null if none is selected / none exist. */
export function getActiveAccount(): Account | null {
  const s = readAccountsFile()
  return s.activeId ? s.accounts.find((a) => a.id === s.activeId) ?? null : null
}

/** Add a new account (or replace one with the same id, e.g. re-sign-in) and make it active. */
export function upsertAccount(a: Account): void {
  const s = readAccountsFile()
  const rest = s.accounts.filter((x) => x.id !== a.id)
  writeAccountsFile({ accounts: [...rest, a], activeId: a.id })
}

/** Add an offline nickname account and make it active. */
export function addOfflineAccount(name: string): Account {
  const s = readAccountsFile()
  const a: Account = { id: randomUUID(), name: name.trim() || 'Player', type: 'offline' }
  writeAccountsFile({ accounts: [...s.accounts, a], activeId: a.id })
  return a
}

/** Rename an offline account (licensed names are fixed by Microsoft). */
export function renameAccount(id: string, name: string): void {
  const s = readAccountsFile()
  writeAccountsFile({
    accounts: s.accounts.map((a) => (a.id === id && a.type === 'offline' ? { ...a, name: name.trim() || a.name } : a)),
    activeId: s.activeId
  })
}

/** Persist refreshed tokens for an existing account without changing which one is active. */
export function updateAccount(a: Account): void {
  const s = readAccountsFile()
  if (!s.accounts.some((x) => x.id === a.id)) return
  writeAccountsFile({ accounts: s.accounts.map((x) => (x.id === a.id ? a : x)), activeId: s.activeId })
}

/** Set the active account. null = none. */
export function setActiveAccount(id: string | null): void {
  const s = readAccountsFile()
  const activeId = id && s.accounts.some((a) => a.id === id) ? id : null
  writeAccountsFile({ accounts: s.accounts, activeId })
}

/** Remove an account; if it was active, fall back to another one (or none). */
export function removeAccount(id: string): void {
  const s = readAccountsFile()
  const accounts = s.accounts.filter((a) => a.id !== id)
  const activeId = s.activeId === id ? accounts[0]?.id ?? null : s.activeId
  writeAccountsFile({ accounts, activeId })
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
