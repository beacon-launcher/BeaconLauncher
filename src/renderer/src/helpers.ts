import type { ContentType, Loader } from './types'
import { t } from './i18n'

const RANDOM_WORDS = ['Craft', 'Pixel', 'Diamond', 'Creeper', 'Ender', 'Shadow', 'Nova', 'Blaze', 'Frost', 'Turbo', 'Ghost', 'Miner', 'Wolf', 'Fox', 'Storm', 'Titan', 'Cyber', 'Neon', 'Lunar', 'Solar', 'Void', 'Rogue']

export function randomUsername(): string {
  const pick = (): string => RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)]
  const num = Math.floor(Math.random() * 100)
  return `${pick()}_${pick()}${num}`.slice(0, 16)
}

export const CONSOLE_ART_KEY = 'consoleArt'

export function cleanConsole(raw: string): string {
  if (!raw.includes('<log4j:')) return raw
  const out = raw.replace(/<log4j:Event\b[\s\S]*?<\/log4j:Event>/g, (block) => {
    const level = /level="([^"]*)"/.exec(block)?.[1] ?? 'INFO'
    const thread = /thread="([^"]*)"/.exec(block)?.[1] ?? ''
    const ts = /timestamp="([^"]*)"/.exec(block)?.[1]
    const msg = /<log4j:Message>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/log4j:Message>/.exec(block)?.[1]?.trim() ?? ''
    const thr = /<log4j:Throwable>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/log4j:Throwable>/.exec(block)?.[1]?.trim()
    const time = ts ? new Date(Number(ts)).toLocaleTimeString(undefined, { hour12: false }) : ''
    const head = `${time ? `[${time}] ` : ''}${thread ? `[${thread}/${level}] ` : `[${level}] `}`
    return head + msg + (thr ? `\n${thr}` : '')
  })
  return out.replace(/<log4j:Event\b[\s\S]*$/, '')
}

export const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : `${n}`

export function fmtPlaytime(ms?: number): string | null {
  const min = Math.floor((ms ?? 0) / 60000)
  if (min < 1) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function timeAgo(iso: string): string {
  const d = Date.parse(iso)
  if (!d) return ''
  const s = Math.floor((Date.now() - d) / 1000)
  for (const [sec, key] of [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ] as [number, string][]) {
    const n = Math.floor(s / sec)
    if (n >= 1) {
      const unit = n > 1 ? t(key + 's') : t(key)
      return `${n} ${unit} ${t('ago')}`
    }
  }
  return t('justNow')
}

export function mdToText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let c = hex.replace('#', '')
  if (c.length === 3) c = c.split('').map((x) => x + x).join('')
  if (c.length !== 6) return { h: 0, s: 0, v: 1 }
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = h * 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export const JAVA_KEYS: Record<number, keyof import('./types').Settings> = { 25: 'java25', 21: 'java21', 17: 'java17', 8: 'java8' }

export const ACCENTS: { labelKey: string; color: string }[] = [
  { labelKey: 'accentDefault', color: '#ffffff' },
  { labelKey: 'accentBlue', color: '#3b82f6' },
  { labelKey: 'accentRed', color: '#ef4444' },
  { labelKey: 'accentGreen', color: '#22c55e' },
  { labelKey: 'accentPurple', color: '#a78bfa' },
  { labelKey: 'accentOrange', color: '#f59e0b' },
  { labelKey: 'accentSky', color: '#38bdf8' },
  { labelKey: 'accentPink', color: '#f472b6' },
  { labelKey: 'accentYellow', color: '#eab308' }
]

export const LOADERS: { key: Loader; labelKey: string }[] = [
  { key: 'vanilla', labelKey: 'loaderVanilla' },
  { key: 'fabric', labelKey: 'loaderFabric' },
  { key: 'quilt', labelKey: 'loaderQuilt' },
  { key: 'neoforge', labelKey: 'loaderNeoForge' },
  { key: 'forge', labelKey: 'loaderForge' }
]

export const CONTENT_TABS: { type: ContentType; labelKey: string; singularKey: string }[] = [
  { type: 'mod', labelKey: 'mods', singularKey: 'mod' },
  { type: 'resourcepack', labelKey: 'resourcePacks', singularKey: 'resourcePack' },
  { type: 'datapack', labelKey: 'dataPacks', singularKey: 'dataPack' },
  { type: 'shader', labelKey: 'shaders', singularKey: 'shader' }
]

export const tabsFor = (loader: string): typeof CONTENT_TABS => (loader === 'vanilla' ? CONTENT_TABS.filter((t) => t.type !== 'mod') : CONTENT_TABS)

export const PAGE = 20
