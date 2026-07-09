import { join, basename } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync, renameSync, writeFileSync, readFileSync, copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { instanceDir, getProfile } from './store'

const UA = 'Beacon-Launcher/0.1 (open-source offline launcher)'

// Small in-memory TTL cache for Modrinth GET responses (search results, project pages). Modrinth
// rate-limits, and the UI re-queries a lot (debounced typing, re-opening the modpack browser, page
// flipping back and forth), so caching identical requests for a few minutes avoids 429s. Only
// successful results are cached — errors propagate uncached so they can be retried immediately.
const CACHE_TTL = 5 * 60 * 1000
const apiCache = new Map<string, { at: number; val: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = apiCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.val as T
  // De-dupe concurrent identical requests (e.g. two components mounting at once) — they share one
  // network call instead of both hammering Modrinth and risking a 429.
  const dup = inflight.get(key)
  if (dup) return dup as Promise<T>
  const p = (async () => {
    const val = await fn()
    if (val != null) apiCache.set(key, { at: Date.now(), val }) // don't cache "not found"/failures
    return val
  })()
  inflight.set(key, p)
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}

// GET a Modrinth URL, transparently retrying on 429 (rate limited). Modrinth sends a `Retry-After`
// header (seconds) — honour it, otherwise back off exponentially. This is what actually stops the
// "Modrinth search failed (429)" the user still saw despite caching.
async function mfetch(url: string): Promise<Response> {
  const MAX = 4
  for (let attempt = 0; attempt <= MAX; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.status !== 429 || attempt === MAX) return res
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 15) : Math.min(2 ** attempt, 8)) * 1000
    await new Promise((r) => setTimeout(r, waitMs))
  }
  // Unreachable, but satisfies the type checker.
  return fetch(url, { headers: { 'User-Agent': UA } })
}

// The four content kinds Modrinth serves, each into its own instance folder.
export type ContentType = 'mod' | 'resourcepack' | 'datapack' | 'shader'
const FOLDER: Record<ContentType, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  datapack: 'datapacks',
  shader: 'shaderpacks'
}
const EXT: Record<ContentType, string> = { mod: '.jar', resourcepack: '.zip', datapack: '.zip', shader: '.zip' }

const contentDir = (profileId: string, type: ContentType): string => join(instanceDir(profileId), FOLDER[type])
export function contentFolder(profileId: string, type: ContentType): string {
  const dir = contentDir(profileId, type)
  mkdirSync(dir, { recursive: true })
  return dir
}

// Which catalogue a hit / install came from. Modrinth is keyless; CurseForge needs an API key.
export type Source = 'modrinth' | 'curseforge'

export interface ModHit {
  id: string
  title: string
  description: string
  author: string
  downloads: number
  follows: number
  iconUrl: string
  updated: string
  slug: string
  source?: Source
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

// Modrinth search — open API, no key. Loader facet only applies to mods (resource/data/shader
// packs are loader-agnostic). `offset` drives pagination; returns the total hit count too.
export async function searchModrinth(
  query: string,
  mcVersion: string,
  loader: string,
  sort = 'relevance',
  type: ContentType = 'mod',
  offset = 0
): Promise<{ total: number; hits: ModHit[] }> {
  return cached(`search:${type}:${mcVersion}:${loader}:${sort}:${offset}:${query}`, async () => {
    const facets: string[][] = [[`project_type:${type}`], [`versions:${mcVersion}`]]
    if (type === 'mod' && loader !== 'vanilla') facets.push([`categories:${loader}`])
    const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
    const url =
      `https://api.modrinth.com/v2/search?limit=20&offset=${offset}&index=${index}` +
      `&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`
    const res = await mfetch(url)
    if (!res.ok) throw new Error(`Modrinth search failed (${res.status})`)
    const data = (await res.json()) as any
    return { total: data.total_hits || 0, hits: (data.hits || []).map(toHit) }
  })
}

function toHit(h: any): ModHit {
  return {
    id: h.project_id,
    title: h.title,
    description: h.description || '',
    author: h.author || '',
    downloads: h.downloads || 0,
    follows: h.follows || 0,
    iconUrl: h.icon_url || '',
    updated: h.date_modified || '',
    slug: h.slug || ''
  }
}

// Modrinth modpack search. Unlike mod search this is version/loader-agnostic — a modpack pins its
// own Minecraft version + loader, which we read from the .mrpack when importing.
export async function searchModpacks(query: string, sort = 'relevance', offset = 0): Promise<{ total: number; hits: ModHit[] }> {
  return cached(`modpacks:${sort}:${offset}:${query}`, async () => {
    const facets: string[][] = [['project_type:modpack']]
    const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
    const url =
      `https://api.modrinth.com/v2/search?limit=20&offset=${offset}&index=${index}` +
      `&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`
    const res = await mfetch(url)
    if (!res.ok) throw new Error(`Modrinth search failed (${res.status})`)
    const data = (await res.json()) as any
    return { total: data.total_hits || 0, hits: (data.hits || []).map(toHit) }
  })
}

// Download a Modrinth modpack's latest .mrpack to a temp file and return its path. The caller
// (modpack:importFromModrinth) then reads it with readModpack and imports it like a local file.
export async function downloadModpackToTemp(projectId: string): Promise<string> {
  const res = await mfetch(`https://api.modrinth.com/v2/project/${projectId}/version`)
  if (!res.ok) throw new Error(`Modrinth version lookup failed (${res.status})`)
  const versions = (await res.json()) as any[]
  // Versions come newest-first; take the newest that actually ships an .mrpack.
  let file: { url: string; filename: string } | undefined
  for (const v of versions) {
    const files = (v.files || []) as any[]
    const f = files.find((x) => x.primary && /\.mrpack$/i.test(x.filename)) || files.find((x) => /\.mrpack$/i.test(x.filename))
    if (f) {
      file = { url: f.url, filename: f.filename }
      break
    }
  }
  if (!file) throw new Error('This project has no .mrpack file to import.')
  const dest = join(tmpdir(), `beacon-modpack-${projectId}-${file.filename}`)
  await download(file.url, dest)
  return dest
}

// Copy dropped-in files (drag & drop onto the Mods list) into the content folder.
// Accepts .jar / .zip only; returns the filenames that were actually added.
export function addFiles(profileId: string, type: ContentType, paths: string[]): string[] {
  const dir = contentFolder(profileId, type)
  const added: string[] = []
  for (const p of paths) {
    const name = basename(p)
    if (!/\.(jar|zip)$/i.test(name)) continue
    try {
      copyFileSync(p, join(dir, name))
      added.push(name)
    } catch {
      /* ignore unreadable / permission errors */
    }
  }
  return added
}

// The newest Modrinth version of a project compatible with a profile's MC version + loader.
// Returns the full version object (files + dependencies) or null if nothing matches.
async function fetchVersion(projectId: string, mcVersion: string, loader: string, type: ContentType): Promise<any | null> {
  const gv = encodeURIComponent(JSON.stringify([mcVersion]))
  let url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${gv}`
  if (type === 'mod' && loader !== 'vanilla') url += `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const res = await mfetch(url)
  if (!res.ok) throw new Error(`Modrinth version lookup failed (${res.status})`)
  const versions = (await res.json()) as any[]
  return versions[0] ?? null
}

// A specific Modrinth version by id — used to honour a dependency that pins an exact build.
async function fetchVersionById(versionId: string): Promise<any | null> {
  const res = await mfetch(`https://api.modrinth.com/v2/version/${versionId}`)
  if (!res.ok) return null
  return (await res.json()) as any
}

// Minimal project info (title / icon / slug) for labelling an auto-installed dependency.
async function fetchProjectBasic(projectId: string): Promise<{ title?: string; iconUrl?: string; slug?: string }> {
  try {
    const res = await mfetch(`https://api.modrinth.com/v2/project/${projectId}`)
    if (!res.ok) return {}
    const p = (await res.json()) as any
    return { title: p.title, iconUrl: p.icon_url || undefined, slug: p.slug }
  } catch {
    return {}
  }
}

// Project ids a Modrinth version declares INCOMPATIBLE. Stored per installed mod so conflict checks
// work in both directions (e.g. Sodium declares Iris incompatible → caught when installing Iris too).
function incompatibleIds(deps: any): string[] | undefined {
  const ids = ((deps || []) as any[]).filter((d) => d.dependency_type === 'incompatible' && d.project_id).map((d) => d.project_id as string)
  return ids.length ? ids : undefined
}

// Download a resolved version's primary file into the content folder and cache its metadata,
// so the installed list can show a rich row (icon / title / author / version) without re-querying.
async function downloadVersion(
  profileId: string,
  type: ContentType,
  version: any,
  projectId: string,
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
): Promise<string> {
  const files = (version.files || []) as any[]
  const file = files.find((f) => f.primary) || files[0]
  if (!file) throw new Error('No downloadable file')
  const dir = contentFolder(profileId, type)
  await download(file.url, join(dir, file.filename))
  saveMeta(profileId, type, file.filename, {
    sha1: file.hashes?.sha1 ?? '',
    source: 'modrinth',
    projectId,
    slug: hit?.slug,
    title: hit?.title,
    author: hit?.author,
    iconUrl: hit?.iconUrl || undefined,
    version: version.version_number || undefined,
    incompatible: incompatibleIds(version.dependencies)
  })
  return file.filename
}

// Install the newest compatible build of a project — single file, no dependency handling.
// Used by updateContent (updates must not cascade new deps). installContent() is the
// dependency-aware entry point the browse UI uses.
export async function installModrinth(
  profileId: string,
  projectId: string,
  mcVersion: string,
  loader: string,
  type: ContentType = 'mod',
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
): Promise<string> {
  const version = await fetchVersion(projectId, mcVersion, loader, type)
  if (!version) throw new Error('No build compatible with this profile')
  return downloadVersion(profileId, type, version, projectId, hit)
}

export interface InstalledDep {
  name: string
  title?: string
}
export interface InstallResult {
  filename: string
  // Required dependencies we auto-installed alongside the requested mod (e.g. Sodium for Iris).
  installedDeps: InstalledDep[]
  // Titles of already-installed mods the requested project's metadata declares INCOMPATIBLE.
  incompatible: string[]
}

// Dependency-aware install (the entry point the UI uses). For mods this also:
//  • auto-installs missing REQUIRED dependencies (installing Iris pulls in Sodium), and
//  • reports already-installed mods the new project declares INCOMPATIBLE, so the UI can warn
//    instead of silently producing a profile the loader rejects at launch.
// It never replaces or downgrades an already-installed mod. Resource/data/shader packs have no
// cross-file deps, so they fall through to a plain single-file install.
export async function installContent(
  profileId: string,
  projectId: string,
  mcVersion: string,
  loader: string,
  type: ContentType = 'mod',
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string },
  source: Source = 'modrinth'
): Promise<InstallResult> {
  void source // CurseForge disabled for now — see the commented block at the end of this file.
  // if (source === 'curseforge') return installCurseForge(profileId, projectId, mcVersion, loader, type, hit)
  const version = await fetchVersion(projectId, mcVersion, loader, type)
  if (!version) throw new Error('No build compatible with this profile')
  const deps = (version.dependencies || []) as any[]

  // Flag conflicts with already-installed mods, in BOTH directions:
  //  • forward — the new mod declares an installed mod incompatible, and
  //  • reverse — an installed mod declares the new mod incompatible (uses each mod's stored
  //    `incompatible` list, so no extra network). This catches pairs like Sodium/Iris where only
  //    one side declares the conflict. Informational only — we still install what was asked.
  const incompatible: string[] = []
  if (type === 'mod') {
    const cache = readCache(profileId)['mod'] ?? {}
    const installed = listContent(profileId, 'mod').filter((i) => i.projectId)
    const declaredByNew = new Set(incompatibleIds(deps) ?? [])
    const seen = new Set<string>()
    for (const it of installed) {
      const pid = it.projectId!
      const conflicts = declaredByNew.has(pid) || (cache[it.name]?.incompatible ?? []).includes(projectId)
      if (conflicts && !seen.has(pid)) {
        seen.add(pid)
        incompatible.push(it.title || it.name)
      }
    }
  }

  const filename = await downloadVersion(profileId, type, version, projectId, hit)

  // Pull in missing required dependencies (one level deep, bounded, best-effort). A pinned
  // version_id is honoured so we grab the exact build the author vouches for; otherwise we take
  // the newest compatible one. Anything that fails to resolve/download is skipped silently — the
  // primary mod is still installed.
  const installedDeps: InstalledDep[] = []
  if (type === 'mod') {
    // Resolve unknown files first so an already-present-but-unidentified dependency (e.g. a
    // manually-added Fabric API) is recognised and NOT installed a second time.
    await enrichContent(profileId, 'mod')
    const have = new Set(listContent(profileId, 'mod').map((i) => i.projectId).filter(Boolean) as string[])
    have.add(projectId)
    for (const dep of deps) {
      if (dep.dependency_type !== 'required' || !dep.project_id || have.has(dep.project_id)) continue
      try {
        let depVersion = dep.version_id ? await fetchVersionById(dep.version_id) : null
        if (!depVersion) depVersion = await fetchVersion(dep.project_id, mcVersion, loader, 'mod')
        if (!depVersion) continue
        const info = await fetchProjectBasic(dep.project_id)
        const depName = await downloadVersion(profileId, 'mod', depVersion, dep.project_id, info)
        have.add(dep.project_id)
        installedDeps.push({ name: depName, title: info.title })
      } catch {
        /* dependency skipped — primary mod still installed */
      }
    }
  }

  return { filename, installedDeps, incompatible }
}

export interface ProjectDetail {
  id: string
  slug: string
  title: string
  description: string
  body: string
  iconUrl: string
  author: string
  downloads: number
  follows: number
  categories: string[]
  gallery: string[]
  source?: string
  issues?: string
  wiki?: string
  discord?: string
  updated: string
  origin?: Source // which catalogue this detail came from (drives the platform link/label)
  website?: string // the project's page on its catalogue (CurseForge has no slug-based URL scheme like Modrinth)
}

// Full project detail (for the in-app detail page): metadata + long description body. Routes to
// the right catalogue by `source`.
export async function getProject(idOrSlug: string, source: Source = 'modrinth'): Promise<ProjectDetail | null> {
  void source // CurseForge disabled for now.
  // if (source === 'curseforge') return getCurseForgeProject(idOrSlug)
  return cached(`project:${idOrSlug}`, async () => {
  const res = await mfetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(idOrSlug)}`)
  if (!res.ok) return null
  const p = (await res.json()) as any
  let author = ''
  try {
    const tr = await mfetch(`https://api.modrinth.com/v2/project/${p.id}/members`)
    if (tr.ok) {
      const members = (await tr.json()) as any[]
      const owner = members.find((m) => m.role === 'Owner') ?? members[0]
      author = owner?.user?.username ?? ''
    }
  } catch {
    /* author optional */
  }
  return {
    id: p.id,
    slug: p.slug || p.id,
    title: p.title || '',
    description: p.description || '',
    body: p.body || '',
    iconUrl: p.icon_url || '',
    author,
    downloads: p.downloads || 0,
    follows: p.followers || 0,
    categories: p.categories || [],
    gallery: ((p.gallery || []) as any[]).map((g) => g.url).filter(Boolean),
    source: p.source_url || undefined,
    issues: p.issues_url || undefined,
    wiki: p.wiki_url || undefined,
    discord: p.discord_url || undefined,
    updated: p.updated || '',
    origin: 'modrinth',
    website: `https://modrinth.com/project/${p.slug || p.id}`
  }
  })
}

export interface ContentMeta {
  sha1: string
  source: 'modrinth' | 'local' | 'curseforge'
  projectId?: string
  slug?: string
  title?: string
  author?: string
  iconUrl?: string
  version?: string
  fileId?: number // CurseForge only: the installed file's id, used to detect updates
  incompatible?: string[] // project ids this mod's build declares incompatible (for conflict warnings)
}

export interface ContentItem {
  name: string
  enabled: boolean
  source?: 'modrinth' | 'local' | 'curseforge'
  projectId?: string
  slug?: string
  title?: string
  author?: string
  iconUrl?: string
  version?: string
}

// ── Per-profile metadata cache ────────────────────────────────────────────────
// Modrinth data for installed files, keyed by content type then filename, so we only
// pay the network lookup once. Manual/unknown files get a `source: 'local'` stub.
type MetaCache = Partial<Record<ContentType, Record<string, ContentMeta>>>

const metaPath = (profileId: string): string => join(instanceDir(profileId), '.beacon-content.json')

function readCache(profileId: string): MetaCache {
  try {
    return JSON.parse(readFileSync(metaPath(profileId), 'utf-8'))
  } catch {
    return {}
  }
}

function writeCache(profileId: string, cache: MetaCache): void {
  try {
    writeFileSync(metaPath(profileId), JSON.stringify(cache, null, 2))
  } catch {
    /* ignore */
  }
}

function saveMeta(profileId: string, type: ContentType, filename: string, meta: ContentMeta): void {
  const cache = readCache(profileId)
  const byName = (cache[type] ??= {})
  byName[filename] = meta
  writeCache(profileId, cache)
}

const withMeta = (name: string, enabled: boolean, meta?: ContentMeta): ContentItem => ({
  name,
  enabled,
  source: meta?.source,
  projectId: meta?.projectId,
  slug: meta?.slug,
  title: meta?.title,
  author: meta?.author,
  iconUrl: meta?.iconUrl,
  version: meta?.version
})

// Installed items of a type. A disabled item keeps a trailing ".disabled" on disk.
// Fast/sync: merges in whatever metadata is already cached, no network.
export function listContent(profileId: string, type: ContentType): ContentItem[] {
  const dir = contentDir(profileId, type)
  if (!existsSync(dir)) return []
  const ext = EXT[type]
  const cache = readCache(profileId)[type] ?? {}
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().replace(/\.disabled$/, '').endsWith(ext))
    .map((f) => {
      const name = f.replace(/\.disabled$/, '')
      return withMeta(name, !f.endsWith('.disabled'), cache[name])
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Look up any not-yet-known files on Modrinth by their SHA-1 hash and cache the result,
// then return the freshly enriched list. Three batched calls total regardless of count:
// version_files → projects (title/icon) → teams (author). Network failures are swallowed
// so the list still renders from filenames.
export async function enrichContent(profileId: string, type: ContentType): Promise<ContentItem[]> {
  const dir = contentDir(profileId, type)
  if (!existsSync(dir)) return []
  const ext = EXT[type]
  const cache = readCache(profileId)
  const byName = (cache[type] ??= {})
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().replace(/\.disabled$/, '').endsWith(ext))
    .map((f) => f.replace(/\.disabled$/, ''))

  // Only hash + look up files we haven't resolved yet.
  const pending = files.filter((name) => !byName[name])
  if (pending.length) {
    const hashes: Record<string, string> = {}
    for (const name of pending) {
      try {
        const buf = readFileSync(join(dir, existsSync(join(dir, name)) ? name : `${name}.disabled`))
        hashes[name] = createHash('sha1').update(buf).digest('hex')
      } catch {
        /* unreadable — skip */
      }
    }
    try {
      await resolveHashes(byName, hashes)
    } catch {
      /* offline / API error — leave unresolved, they show filename fallback */
    }
    // Mark anything still unresolved as a local file so we don't re-query next time.
    for (const name of pending) {
      if (!byName[name]) byName[name] = { sha1: hashes[name] ?? '', source: 'local' }
    }
    writeCache(profileId, cache)
  }
  return listContent(profileId, type)
}

// Resolve a batch of {filename → sha1} against Modrinth, writing found metadata into `byName`.
async function resolveHashes(byName: Record<string, ContentMeta>, hashes: Record<string, string>): Promise<void> {
  const list = Object.entries(hashes).filter(([, h]) => h)
  if (!list.length) return
  const headers = { 'User-Agent': UA, 'Content-Type': 'application/json' }
  const vres = await fetch('https://api.modrinth.com/v2/version_files', {
    method: 'POST',
    headers,
    body: JSON.stringify({ hashes: list.map(([, h]) => h), algorithm: 'sha1' })
  })
  if (!vres.ok) return
  const versions = (await vres.json()) as Record<string, any>

  // Collect the projects we matched, then fetch title/icon and author in two batched calls.
  const byProject: Record<string, { title?: string; iconUrl?: string; author?: string; slug?: string; team?: string }> = {}
  for (const v of Object.values(versions)) if (v?.project_id) byProject[v.project_id] ??= {}
  const ids = Object.keys(byProject)
  if (ids.length) {
    try {
      const pres = await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, { headers })
      if (pres.ok) {
        for (const p of (await pres.json()) as any[]) {
          byProject[p.id] = { title: p.title, iconUrl: p.icon_url || undefined, slug: p.slug, team: p.team }
        }
      }
      const teamIds = ids.map((id) => byProject[id]?.team).filter(Boolean)
      if (teamIds.length) {
        const tres = await fetch(`https://api.modrinth.com/v2/teams?ids=${encodeURIComponent(JSON.stringify(teamIds))}`, { headers })
        if (tres.ok) {
          const teams = (await tres.json()) as any[][]
          for (const members of teams) {
            const owner = members.find((m) => m.role === 'Owner') ?? members[0]
            const team = owner?.team_id
            const entry = Object.values(byProject).find((e) => e.team === team)
            if (entry && owner?.user?.username) entry.author = owner.user.username
          }
        }
      }
    } catch {
      /* project/team enrichment failed — keep version-level data */
    }
  }

  for (const [name, hash] of list) {
    const v = versions[hash]
    if (!v?.project_id) continue
    const p = byProject[v.project_id] ?? {}
    byName[name] = {
      sha1: hash,
      source: 'modrinth',
      projectId: v.project_id,
      slug: p.slug,
      title: p.title,
      author: p.author,
      iconUrl: p.iconUrl,
      version: v.version_number || undefined,
      incompatible: incompatibleIds(v.dependencies)
    }
  }
}

export function toggleContent(profileId: string, type: ContentType, name: string, enable: boolean): void {
  const dir = contentDir(profileId, type)
  const clean = name.replace(/[\\/]/g, '')
  const on = join(dir, clean)
  const off = join(dir, `${clean}.disabled`)
  try {
    if (enable && existsSync(off)) renameSync(off, on)
    else if (!enable && existsSync(on)) renameSync(on, off)
  } catch {
    /* ignore */
  }
}

export function removeContent(profileId: string, type: ContentType, name: string): void {
  const dir = contentDir(profileId, type)
  const clean = name.replace(/[\\/]/g, '')
  const on = join(dir, clean)
  const off = join(dir, `${clean}.disabled`)
  for (const p of [on, off]) {
    try {
      rmSync(p, { force: true })
    } catch {
      /* ignore (e.g. file locked by the running game / antivirus) */
    }
  }
  // Only forget the metadata if the file is ACTUALLY gone. If the delete failed (locked file), keep
  // the metadata so the leftover file is still identified — otherwise it becomes an unlabelled
  // orphan, which is exactly what produced duplicate mods. Repair can still clean it up later.
  if (!existsSync(on) && !existsSync(off)) {
    const cache = readCache(profileId)
    if (cache[type]?.[clean]) {
      delete cache[type]![clean]
      writeCache(profileId, cache)
    }
  }
}

// The latest Modrinth version of a project compatible with a profile's MC version + loader.
async function latestVersion(
  projectId: string,
  mcVersion: string,
  loader: string,
  type: ContentType
): Promise<{ versionNumber: string } | null> {
  const gv = encodeURIComponent(JSON.stringify([mcVersion]))
  let url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${gv}`
  if (type === 'mod' && loader !== 'vanilla') url += `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const versions = (await res.json()) as any[]
  if (!versions.length) return null
  return { versionNumber: versions[0].version_number || '' }
}

// For every installed Modrinth item, check whether a newer compatible build exists.
// Returns { filename → newVersionNumber } for items that have an update available.
// Bounded concurrency so a big mods folder doesn't fire dozens of requests at once.
export async function checkUpdates(profileId: string, type: ContentType): Promise<Record<string, string>> {
  const profile = getProfile(profileId)
  if (!profile) return {}
  const cache = readCache(profileId)[type] ?? {}
  const items = listContent(profileId, type).filter((it) => cache[it.name]?.projectId && cache[it.name]?.version)
  const updates: Record<string, string> = {}
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const it = items[i++]
      const meta = cache[it.name]
      try {
        const latest = await latestVersion(meta.projectId!, profile.mcVersion, profile.loader, type)
        if (latest && latest.versionNumber && latest.versionNumber !== meta.version) updates[it.name] = latest.versionNumber
      } catch {
        /* skip this one */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, worker))
  return updates
}

// Update one installed item to the latest compatible Modrinth build. Downloads the new file,
// removes the old one if the filename changed, and preserves the enabled/disabled state.
export async function updateContent(profileId: string, type: ContentType, name: string): Promise<string> {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('Profile not found')
  const meta = readCache(profileId)[type]?.[name]
  if (!meta?.projectId) throw new Error('This item was not installed from a catalogue')
  const dir = contentDir(profileId, type)
  const wasDisabled = !existsSync(join(dir, name)) && existsSync(join(dir, `${name}.disabled`))
  const hit = { title: meta.title, author: meta.author, iconUrl: meta.iconUrl, slug: meta.slug }
  const newName = await installModrinth(profileId, meta.projectId, profile.mcVersion, profile.loader, type, hit)
  if (newName !== name) removeContent(profileId, type, name)
  if (wasDisabled) toggleContent(profileId, type, newName, false)
  return newName
}

// Repair a profile's content: resolve unknown files, then remove duplicate items (the same project
// present as several files) keeping only the newest of each. This fixes the "duplicate mods in the
// folder" state left behind when an update or version change failed to delete the old file.
export async function repairProfile(profileId: string): Promise<{ removed: string[] }> {
  const removed: string[] = []
  const sizeOf = (dir: string, name: string): number => {
    for (const p of [join(dir, name), join(dir, `${name}.disabled`)]) {
      try {
        return statSync(p).size
      } catch {
        /* try the other */
      }
    }
    return -1
  }
  for (const type of Object.keys(FOLDER) as ContentType[]) {
    const dir = contentDir(profileId, type)
    if (!existsSync(dir)) continue

    // 1. Remove empty (0-byte) files — a failed/interrupted download leaves those and they crash the
    //    game or the loader at launch.
    for (const it of listContent(profileId, type)) {
      if (sizeOf(dir, it.name) === 0) {
        removeContent(profileId, type, it.name)
        removed.push(it.name)
      }
    }

    // Resolve any not-yet-identified files so orphans (no cached metadata) can still be grouped.
    await enrichContent(profileId, type)
    const cache = readCache(profileId)[type] ?? {}
    const byProject = new Map<string, string[]>()
    for (const it of listContent(profileId, type)) {
      const pid = cache[it.name]?.projectId
      if (!pid) continue // never touch files we can't confidently identify
      byProject.set(pid, [...(byProject.get(pid) ?? []), it.name])
    }

    // 2. De-duplicate: same project present as several files → keep the most recently written one.
    for (const names of byProject.values()) {
      if (names.length < 2) continue
      const dated = names.map((n) => {
        const path = existsSync(join(dir, n)) ? join(dir, n) : join(dir, `${n}.disabled`)
        let mtime = 0
        try {
          mtime = statSync(path).mtimeMs
        } catch {
          /* missing */
        }
        return { n, mtime }
      })
      dated.sort((a, b) => b.mtime - a.mtime)
      for (const { n } of dated.slice(1)) {
        removeContent(profileId, type, n)
        removed.push(n)
      }
    }
  }
  return { removed }
}

// All Minecraft versions a Modrinth project has a build for (for the given loader).
async function modGameVersions(projectId: string, loader: string): Promise<Set<string>> {
  let url = `https://api.modrinth.com/v2/project/${projectId}/version`
  if (loader !== 'vanilla') url += `?loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const res = await mfetch(url)
  const out = new Set<string>()
  if (!res.ok) return out
  for (const v of (await res.json()) as any[]) for (const g of v.game_versions || []) out.add(g)
  return out
}

// The Minecraft versions a profile could switch to while keeping ALL its installed Modrinth mods —
// i.e. the intersection of every mod's supported versions (for this loader). `unresolved` lists mods
// we can't check (local / non-Modrinth), which the UI should warn about. When there are no
// Modrinth mods to constrain, `versions` is null → the caller offers the full version list.
export async function compatibleVersions(profileId: string): Promise<{ versions: string[] | null; unresolved: string[] }> {
  const profile = getProfile(profileId)
  if (!profile) return { versions: null, unresolved: [] }
  // Resolve manually-added mods first so they're counted (a known Modrinth mod with no cached
  // projectId would otherwise be treated as unresolved and skew the result).
  await enrichContent(profileId, 'mod')
  const cache = readCache(profileId)['mod'] ?? {}
  const items = listContent(profileId, 'mod')
  const modrinth = items.filter((it) => cache[it.name]?.source === 'modrinth' && cache[it.name]?.projectId)
  const unresolved = items.filter((it) => !(cache[it.name]?.source === 'modrinth' && cache[it.name]?.projectId)).map((it) => it.title || it.name)
  if (!modrinth.length) return { versions: null, unresolved }

  // Fetch every mod's supported-versions set in parallel (one Modrinth call each) — sequential was
  // slow with a big mods folder — then intersect.
  const sets = await Promise.all(modrinth.map((it) => modGameVersions(cache[it.name]!.projectId!, profile.loader)))
  let inter: Set<string> | null = null
  for (const vers of sets) {
    if (inter === null) {
      inter = vers
    } else {
      const next = new Set<string>()
      for (const v of inter) if (vers.has(v)) next.add(v)
      inter = next
    }
    if (inter.size === 0) break
  }
  return { versions: inter ? [...inter] : [], unresolved }
}

// Migrate every installed Modrinth mod to a build for `mcVersion` (best-effort). Non-Modrinth /
// local mods can't be moved and are reported in `failed`; the caller decides what to do with them.
// Does NOT touch the profile record — the IPC layer updates the profile version separately.
export async function migrateModsToVersion(profileId: string, mcVersion: string): Promise<{ migrated: string[]; failed: string[] }> {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('Profile not found')
  // Resolve manually-added mods first so a known Modrinth mod isn't wrongly treated as un-migratable.
  await enrichContent(profileId, 'mod')
  const cache = readCache(profileId)['mod'] ?? {}
  const migrated: string[] = []
  const failed: string[] = []
  for (const it of listContent(profileId, 'mod')) {
    const meta = cache[it.name]
    const label = it.title || it.name
    if (!(meta?.source === 'modrinth' && meta.projectId)) {
      failed.push(label)
      continue
    }
    try {
      const dir = contentDir(profileId, 'mod')
      const wasDisabled = !existsSync(join(dir, it.name)) && existsSync(join(dir, `${it.name}.disabled`))
      const newName = await installModrinth(profileId, meta.projectId, mcVersion, profile.loader, 'mod', {
        title: meta.title,
        author: meta.author,
        iconUrl: meta.iconUrl,
        slug: meta.slug
      })
      if (newName !== it.name) removeContent(profileId, 'mod', it.name)
      if (wasDisabled) toggleContent(profileId, 'mod', newName, false)
      migrated.push(label)
    } catch {
      failed.push(label)
    }
  }
  return { migrated, failed }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CurseForge — DISABLED for now (whole block commented out). To re-enable:
 *   1. Uncomment this block and put a CurseForge API key in CF_KEY (console.curseforge.com).
 *   2. Restore the `source === 'curseforge'` branches in installContent / getProject /
 *      checkUpdates / updateContent (marked "CurseForge disabled for now").
 *   3. Restore the CurseForge routing in main/index.ts (content:search) and the source
 *      dropdown option in ModsPanel.tsx.
 * ─────────────────────────────────────────────────────────────────────────────

const CF_KEY = '' // ← put a CurseForge API key here to re-enable
const CF_API = 'https://api.curseforge.com/v1'
const CF_GAME = 432 // Minecraft
// CurseForge "class" (content type) ids.
const CF_CLASS: Record<ContentType, number> = { mod: 6, resourcepack: 12, datapack: 6945, shader: 6552 }
// CurseForge modLoaderType ids (mods only).
const CF_LOADER: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
// relationType on a file's dependencies: 1 embedded, 2 optional, 3 required, 4 tool, 5 incompatible, 6 include.
const CF_REQUIRED = 3
const CF_INCOMPATIBLE = 5
// sortField: 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads.
const CF_SORT: Record<string, number> = { relevance: 1, downloads: 6, follows: 2, newest: 3, updated: 3 }

async function cfFetch(path: string): Promise<Response> {
  const headers = { 'x-api-key': CF_KEY, Accept: 'application/json', 'User-Agent': UA }
  const MAX = 3
  for (let attempt = 0; attempt <= MAX; attempt++) {
    const res = await fetch(`${CF_API}${path}`, { headers })
    if (res.status !== 429 || attempt === MAX) return res
    await new Promise((r) => setTimeout(r, Math.min(2 ** attempt, 8) * 1000))
  }
  return fetch(`${CF_API}${path}`, { headers })
}

function cfToHit(m: any): ModHit {
  return {
    id: String(m.id),
    title: m.name || '',
    description: m.summary || '',
    author: m.authors?.[0]?.name || '',
    downloads: m.downloadCount || 0,
    follows: m.thumbsUpCount || 0,
    iconUrl: m.logo?.url || '',
    updated: m.dateModified || m.dateReleased || '',
    slug: m.slug || '',
    source: 'curseforge'
  }
}

export async function searchCurseForge(
  query: string,
  mcVersion: string,
  loader: string,
  sort = 'relevance',
  type: ContentType = 'mod',
  offset = 0
): Promise<{ total: number; hits: ModHit[] }> {
  return cached(`cf:search:${type}:${mcVersion}:${loader}:${sort}:${offset}:${query}`, async () => {
    const params = new URLSearchParams({
      gameId: String(CF_GAME),
      classId: String(CF_CLASS[type]),
      searchFilter: query,
      gameVersion: mcVersion,
      sortField: String(CF_SORT[sort] ?? 1),
      sortOrder: 'desc',
      index: String(offset),
      pageSize: '20'
    })
    if (type === 'mod' && CF_LOADER[loader]) params.set('modLoaderType', String(CF_LOADER[loader]))
    const res = await cfFetch(`/mods/search?${params.toString()}`)
    if (!res.ok) throw new Error(`CurseForge search failed (${res.status})`)
    const data = (await res.json()) as any
    // CurseForge caps deep paging at index+pageSize ≤ 10000; clamp the reported total so the pager
    // can't ask for an out-of-range page.
    const total = Math.min(data.pagination?.totalCount || 0, 10000)
    return { total, hits: ((data.data || []) as any[]).map(cfToHit) }
  })
}

async function getCurseForgeProject(id: string): Promise<ProjectDetail | null> {
  return cached(`cf:project:${id}`, async () => {
    const res = await cfFetch(`/mods/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const m = ((await res.json()) as any).data
    let body = ''
    try {
      const dres = await cfFetch(`/mods/${m.id}/description`)
      if (dres.ok) body = ((await dres.json()) as any).data || ''
    } catch {
      // description optional
    }
    return {
      id: String(m.id),
      slug: m.slug || String(m.id),
      title: m.name || '',
      description: m.summary || '',
      body,
      iconUrl: m.logo?.url || '',
      author: m.authors?.[0]?.name || '',
      downloads: m.downloadCount || 0,
      follows: m.thumbsUpCount || 0,
      categories: ((m.categories || []) as any[]).map((c) => c.name).filter(Boolean),
      gallery: ((m.screenshots || []) as any[]).map((s) => s.url).filter(Boolean),
      source: m.links?.sourceUrl || undefined,
      issues: m.links?.issuesUrl || undefined,
      wiki: m.links?.wikiUrl || undefined,
      discord: undefined,
      updated: m.dateModified || '',
      origin: 'curseforge',
      website: m.links?.websiteUrl || undefined
    }
  })
}

// The newest CurseForge file for a mod compatible with a profile's MC version (+ loader for mods).
async function cfLatestFile(modId: string, mcVersion: string, loader: string, type: ContentType): Promise<any | null> {
  const params = new URLSearchParams({ gameVersion: mcVersion, pageSize: '50' })
  if (type === 'mod' && CF_LOADER[loader]) params.set('modLoaderType', String(CF_LOADER[loader]))
  const res = await cfFetch(`/mods/${modId}/files?${params.toString()}`)
  if (!res.ok) return null
  const files = (((await res.json()) as any).data || []) as any[]
  if (!files.length) return null
  files.sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime())
  return files[0]
}

// The direct download URL for a CurseForge file. When an author has disabled third-party API
// distribution `downloadUrl` is null — reconstruct the CDN path from the file id as a fallback.
function cfDownloadUrl(file: any): string {
  if (file.downloadUrl) return file.downloadUrl
  const id = String(file.id)
  const a = Number(id.slice(0, id.length - 3))
  const b = Number(id.slice(-3))
  return `https://mediafilez.forgecdn.net/files/${a}/${b}/${encodeURIComponent(file.fileName)}`
}

async function cfDownloadFile(
  profileId: string,
  type: ContentType,
  file: any,
  modId: string,
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
): Promise<string> {
  const dir = contentFolder(profileId, type)
  await download(cfDownloadUrl(file), join(dir, file.fileName))
  saveMeta(profileId, type, file.fileName, {
    sha1: '',
    source: 'curseforge',
    projectId: String(modId),
    slug: hit?.slug,
    title: hit?.title,
    author: hit?.author,
    iconUrl: hit?.iconUrl || undefined,
    version: file.displayName || file.fileName,
    fileId: file.id
  })
  return file.fileName
}

async function cfProjectBasic(modId: string): Promise<{ title?: string; iconUrl?: string; slug?: string }> {
  try {
    const res = await cfFetch(`/mods/${modId}`)
    if (!res.ok) return {}
    const m = ((await res.json()) as any).data
    return { title: m.name, iconUrl: m.logo?.url || undefined, slug: m.slug }
  } catch {
    return {}
  }
}

// CurseForge counterpart of installContent: download the newest compatible file, auto-install
// missing required dependencies, and report already-installed mods flagged incompatible.
async function installCurseForge(
  profileId: string,
  modId: string,
  mcVersion: string,
  loader: string,
  type: ContentType,
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
): Promise<InstallResult> {
  const file = await cfLatestFile(modId, mcVersion, loader, type)
  if (!file) throw new Error('No build compatible with this profile')
  const deps = (file.dependencies || []) as any[]

  const incompatible: string[] = []
  if (type === 'mod') {
    const byProject = new Map(
      listContent(profileId, 'mod')
        .filter((i) => i.projectId)
        .map((i) => [i.projectId!, i] as const)
    )
    for (const d of deps) {
      if (d.relationType === CF_INCOMPATIBLE && byProject.has(String(d.modId))) {
        const it = byProject.get(String(d.modId))!
        incompatible.push(it.title || it.name)
      }
    }
  }

  const filename = await cfDownloadFile(profileId, type, file, modId, hit)

  const installedDeps: InstalledDep[] = []
  if (type === 'mod') {
    const have = new Set(listContent(profileId, 'mod').map((i) => i.projectId).filter(Boolean) as string[])
    have.add(String(modId))
    for (const d of deps) {
      if (d.relationType !== CF_REQUIRED || !d.modId || have.has(String(d.modId))) continue
      try {
        const depFile = await cfLatestFile(String(d.modId), mcVersion, loader, 'mod')
        if (!depFile) continue
        const info = await cfProjectBasic(String(d.modId))
        const depName = await cfDownloadFile(profileId, 'mod', depFile, String(d.modId), info)
        have.add(String(d.modId))
        installedDeps.push({ name: depName, title: info.title })
      } catch {
        // dependency skipped — primary mod still installed
      }
    }
  }

  return { filename, installedDeps, incompatible }
}
*/
