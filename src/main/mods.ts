import { join, basename } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync, renameSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { instanceDir, getProfile } from './store'

const UA = 'Beacon-Launcher/0.1 (open-source offline launcher)'

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
  const facets: string[][] = [[`project_type:${type}`], [`versions:${mcVersion}`]]
  if (type === 'mod' && loader !== 'vanilla') facets.push([`categories:${loader}`])
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
  const url =
    `https://api.modrinth.com/v2/search?limit=20&offset=${offset}&index=${index}` +
    `&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Modrinth search failed (${res.status})`)
  const data = (await res.json()) as any
  return {
    total: data.total_hits || 0,
    hits: (data.hits || []).map(
      (h: any): ModHit => ({
        id: h.project_id,
        title: h.title,
        description: h.description || '',
        author: h.author || '',
        downloads: h.downloads || 0,
        follows: h.follows || 0,
        iconUrl: h.icon_url || '',
        updated: h.date_modified || '',
        slug: h.slug || ''
      })
    )
  }
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

export async function installModrinth(
  profileId: string,
  projectId: string,
  mcVersion: string,
  loader: string,
  type: ContentType = 'mod',
  hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
): Promise<string> {
  const gv = encodeURIComponent(JSON.stringify([mcVersion]))
  let url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${gv}`
  if (type === 'mod' && loader !== 'vanilla') url += `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Modrinth version lookup failed (${res.status})`)
  const versions = (await res.json()) as any[]
  if (!versions.length) throw new Error('No build compatible with this profile')
  const files = versions[0].files || []
  const file = files.find((f: any) => f.primary) || files[0]
  if (!file) throw new Error('No downloadable file')
  const dir = contentFolder(profileId, type)
  await download(file.url, join(dir, file.filename))
  // Remember what we know about this file so the installed list can show a rich row
  // (icon / title / author / version) without re-querying Modrinth by hash later.
  saveMeta(profileId, type, file.filename, {
    sha1: file.hashes?.sha1 ?? '',
    source: 'modrinth',
    projectId,
    slug: hit?.slug,
    title: hit?.title,
    author: hit?.author,
    iconUrl: hit?.iconUrl || undefined,
    version: versions[0].version_number || undefined
  })
  return file.filename
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
}

// Full Modrinth project (for the in-app detail page): metadata + long description body.
export async function getProject(idOrSlug: string): Promise<ProjectDetail | null> {
  const headers = { 'User-Agent': UA }
  const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(idOrSlug)}`, { headers })
  if (!res.ok) return null
  const p = (await res.json()) as any
  let author = ''
  try {
    const tr = await fetch(`https://api.modrinth.com/v2/project/${p.id}/members`, { headers })
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
    updated: p.updated || ''
  }
}

export interface ContentMeta {
  sha1: string
  source: 'modrinth' | 'local'
  projectId?: string
  slug?: string
  title?: string
  author?: string
  iconUrl?: string
  version?: string
}

export interface ContentItem {
  name: string
  enabled: boolean
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
      version: v.version_number || undefined
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
  for (const p of [join(dir, clean), join(dir, `${clean}.disabled`)]) {
    try {
      rmSync(p)
    } catch {
      /* ignore */
    }
  }
  // Drop any cached metadata for the removed file.
  const cache = readCache(profileId)
  if (cache[type]?.[clean]) {
    delete cache[type]![clean]
    writeCache(profileId, cache)
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
  if (!meta?.projectId) throw new Error('This item was not installed from Modrinth')
  const dir = contentDir(profileId, type)
  const wasDisabled = !existsSync(join(dir, name)) && existsSync(join(dir, `${name}.disabled`))
  const newName = await installModrinth(profileId, meta.projectId, profile.mcVersion, profile.loader, type, {
    title: meta.title,
    author: meta.author,
    iconUrl: meta.iconUrl,
    slug: meta.slug
  })
  if (newName !== name) removeContent(profileId, type, name)
  if (wasDisabled) toggleContent(profileId, type, newName, false)
  return newName
}
