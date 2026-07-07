import { open, readAllEntries, readEntry } from '@xmcl/unzip'
import type { Loader } from './store'

// Modrinth modpack (.mrpack) — a zip with `modrinth.index.json` (MC version, loader, and a list
// of files with direct download URLs) plus an `overrides/` folder of config to drop into the
// instance. (CurseForge packs use `manifest.json` with project/file IDs → need their API key.)

export interface ModpackFile {
  path: string
  downloads: string[]
  fileSize?: number
  env?: { client?: string; server?: string }
}

export interface ModpackInfo {
  name: string
  mcVersion: string
  loader: Loader
  files: ModpackFile[]
}

const LOADER_KEYS: [string, Loader][] = [
  ['fabric-loader', 'fabric'],
  ['quilt-loader', 'quilt'],
  ['neoforge', 'neoforge'],
  ['forge', 'forge']
]

export async function readModpack(filePath: string): Promise<ModpackInfo> {
  const zip = await open(filePath)
  try {
    const entries = await readAllEntries(zip)
    const indexEntry = entries.find((e) => e.fileName === 'modrinth.index.json')
    if (!indexEntry) {
      const isCurseforge = entries.some((e) => e.fileName === 'manifest.json')
      throw new Error(
        isCurseforge
          ? 'CurseForge packs need a CurseForge API key — export as a Modrinth (.mrpack) pack instead.'
          : 'Not a Modrinth modpack — modrinth.index.json is missing.'
      )
    }
    const index = JSON.parse((await readEntry(zip, indexEntry)).toString('utf-8'))
    const deps = (index.dependencies || {}) as Record<string, string>
    const mcVersion = deps.minecraft
    if (!mcVersion) throw new Error('The modpack does not specify a Minecraft version.')
    let loader: Loader = 'vanilla'
    for (const [key, l] of LOADER_KEYS) if (deps[key]) { loader = l; break }
    const files = ((index.files || []) as ModpackFile[]).filter((f) => f.env?.client !== 'unsupported' && f.downloads?.length)
    return { name: index.name || 'Imported pack', mcVersion, loader, files }
  } finally {
    zip.close()
  }
}
