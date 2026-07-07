// Which Minecraft versions each mod loader supports, so the New-profile dialog can filter
// the version list and auto-correct the selection when you switch loaders. Results are
// cached per loader for the app's lifetime. The renderer intersects these with the real
// Mojang manifest, so any stray/bogus ids here are harmless. `null` means "all versions".

const cache = new Map<string, string[]>()

async function json(url: string): Promise<any> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

async function fabricVersions(): Promise<string[]> {
  const list = (await json('https://meta.fabricmc.net/v2/versions/game')) as { version: string }[]
  return list.map((v) => v.version)
}

async function quiltVersions(): Promise<string[]> {
  const list = (await json('https://meta.quiltmc.org/v3/versions/game')) as { version: string }[]
  return list.map((v) => v.version)
}

async function forgeVersions(): Promise<string[]> {
  const data = (await json('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')) as {
    promos: Record<string, string>
  }
  const keys = Object.keys(data.promos || {})
  return [...new Set(keys.map((k) => k.replace(/-(recommended|latest)$/, '')))]
}

// A NeoForge build maps to a Minecraft version. Legacy "1.x": "21.1.5" → 1.21.1, "21.0.x" →
// 1.21. New "26.x" scheme (Minecraft dropped the leading "1."): the build is "<mc>.<extra>",
// e.g. "26.2.0.8" → 26.2, "26.1.2.77" → 26.1.2. Reversing is ambiguous, so emit every
// plausible MC string — the renderer intersects these with the real Mojang manifest and drops
// anything that isn't an actual version. Future versions work with no code change.
function neoMcCandidates(v: string): string[] {
  const p = v.split('-')[0].split('.')
  const out: string[] = []
  if (p[1] !== undefined) {
    out.push(p[1] === '0' ? `1.${p[0]}` : `1.${p[0]}.${p[1]}`) // legacy 1.x scheme
    out.push(`${p[0]}.${p[1]}`) // new scheme, 2-part MC (e.g. 26.2)
    if (p[2] !== undefined) out.push(`${p[0]}.${p[1]}.${p[2]}`) // new scheme, 3-part MC (e.g. 26.1.2)
  }
  return out
}

async function neoforgeVersions(): Promise<string[]> {
  const set = new Set<string>(['1.20.1'])
  const data = (await json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')) as {
    versions: string[]
  }
  for (const v of data.versions || []) for (const mc of neoMcCandidates(v)) set.add(mc)
  return [...set]
}

export interface LoaderBuild {
  version: string
  stable: boolean
}

// NeoForge build prefix for a Minecraft version (mirrors the installer worker's logic).
function neoPrefix(mc: string): string {
  if (mc.startsWith('1.')) {
    const p = mc.split('.')
    return `${p[1]}.${p[2] ?? '0'}.`
  }
  return `${mc}.`
}

// Available loader builds for a loader + Minecraft version, newest-first. Used by the
// New-profile dialog's Stable / Latest / Other picker. [] for vanilla or on failure.
export async function loaderBuilds(loader: string, mcVersion: string): Promise<LoaderBuild[]> {
  try {
    if (loader === 'fabric') {
      const list = (await json(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`)) as { loader: { version: string; stable?: boolean } }[]
      return list.map((x) => ({ version: x.loader.version, stable: !!x.loader.stable }))
    }
    if (loader === 'quilt') {
      const list = (await json(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`)) as { loader: { version: string } }[]
      return list.map((x) => ({ version: x.loader.version, stable: !/-(beta|pre|rc)/i.test(x.loader.version) }))
    }
    if (loader === 'neoforge') {
      const legacy = mcVersion === '1.20.1'
      const endpoint = legacy
        ? 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge'
        : 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
      const data = (await json(endpoint)) as { versions: string[] }
      const prefix = legacy ? '1.20.1-' : neoPrefix(mcVersion)
      const matches = (data.versions || []).filter((v) => v.startsWith(prefix)).reverse()
      return matches.map((v) => ({ version: v, stable: !v.includes('-') || legacy }))
    }
    if (loader === 'forge') {
      const [xml, promos] = await Promise.all([
        fetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml').then((r) => (r.ok ? r.text() : '')),
        json('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').catch(() => ({ promos: {} }))
      ])
      const rec = (promos.promos || {})[`${mcVersion}-recommended`]
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
      const builds = all
        .filter((v) => v.startsWith(`${mcVersion}-`))
        .map((v) => v.split('-').slice(1).join('-'))
        .reverse()
      return builds.map((b) => ({ version: b, stable: b === rec }))
    }
  } catch {
    /* offline / API error */
  }
  return []
}

/** MC versions the loader supports, or `null` for vanilla (everything). Cached; [] on failure. */
export async function supportedVersions(loader: string): Promise<string[] | null> {
  if (loader === 'vanilla') return null
  const hit = cache.get(loader)
  if (hit) return hit
  let list: string[] = []
  try {
    if (loader === 'fabric') list = await fabricVersions()
    else if (loader === 'quilt') list = await quiltVersions()
    else if (loader === 'forge') list = await forgeVersions()
    else if (loader === 'neoforge') list = await neoforgeVersions()
  } catch {
    list = []
  }
  cache.set(loader, list)
  return list
}
