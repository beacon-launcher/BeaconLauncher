// Localization, backed by i18next. The public API here — `t(key)`, `setLanguage`, `getLanguage`
// — is deliberately the SAME as the old hand-rolled version, so components keep calling `t('key')`
// unchanged. What i18next adds underneath: real plural rules (Russian 1/2/5 forms), {{value}}
// interpolation, and fallback to English for any missing key.
//
// Language switching stays reactive the same way it already was: App writes settings.language,
// that state change re-renders the tree, and t() reads i18next's current language at render time.
//
// Translations are bundled at build. Every JSON file under ./locales (except index.json) is a
// language, auto-registered via the glob below — so adding a language is just dropping in a file,
// no code change here. The files themselves are synced from github.com/beacon-launcher/Translations
// before a build (see scripts/sync-translations.mjs); en/ru are committed as the offline baseline.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import index from './locales/index.json'

export type LanguageMeta = { code: string; name: string; nativeName: string }

// Eagerly bundle every locale file. `import.meta.glob` is a Vite build-time feature: each match
// becomes part of the bundle, so this stays fully offline and needs no network at runtime.
const modules = import.meta.glob<{ default: Record<string, string> }>('./locales/*.json', { eager: true })

const resources: Record<string, { translation: Record<string, string> }> = {}
for (const [path, mod] of Object.entries(modules)) {
  const code = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '')
  if (code === 'index') continue // the manifest, not a language
  resources[code] = { translation: mod.default }
}

/** Languages available in the picker, in manifest order (falls back to whatever got bundled). */
export const availableLanguages: LanguageMeta[] = (index.languages as LanguageMeta[]).filter((l) => resources[l.code])

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  // Our keys are flat (e.g. "newProfile") and contain no dots/colons, so disable the separators
  // that would otherwise treat "a.b" as nested — keeps every existing key working verbatim.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React already escapes rendered strings
  returnNull: false
})

export const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts ?? {})

export const setLanguage = (lang: string): void => {
  // Unknown code (e.g. a language removed from a build) → fall back to English rather than showing
  // raw keys. Resources are bundled, so changeLanguage resolves synchronously — no async flash.
  void i18n.changeLanguage(resources[lang] ? lang : 'en')
}

export const getLanguage = (): string => i18n.language || 'en'

export default i18n
