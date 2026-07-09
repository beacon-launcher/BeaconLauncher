export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'neoforge' | 'forge'

export interface Profile {
  id: string
  name: string
  mcVersion: string
  loader: Loader
  loaderVersion?: string
  created: number
  installed?: boolean
  playtimeMs?: number
  dir?: string
  avatar?: string
  avatarUrl?: string
  maxMemory?: number
}

export interface Settings {
  username: string
  maxMemory: number
  accentColor: string
  theme: 'system' | 'dark' | 'light'
  discordRpc: boolean
  language: string // language code, e.g. 'en' | 'ru' | 'uk'
  java8: string
  java17: string
  java21: string
  java25: string
}

// Public view of an account (no tokens). type distinguishes offline nicknames from licensed ones.
export interface Account {
  id: string
  name: string
  type: 'offline' | 'msa'
}

export interface AccountsState {
  accounts: Account[]
  activeId: string | null
}

export type ContentType = 'mod' | 'resourcepack' | 'datapack' | 'shader'

// Which catalogue content is searched/installed from.
export type ContentSource = 'modrinth' | 'curseforge'

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
  source?: ContentSource
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
  origin?: ContentSource
  website?: string
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
