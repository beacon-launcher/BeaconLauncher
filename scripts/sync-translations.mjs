// Pull COMMUNITY translations from github.com/beacon-launcher/Translations into the app's bundle
// before a build. This is the "bundle at build" delivery model: translators work in the
// Translations repo, and each release ships whatever languages it had at build time.
//
// The Translations repo layout:
//   index.json              → { "languages": [ { code, name, nativeName }, ... ] }
//   <code>/translation.json → the flat key→string map for that language
//
// IMPORTANT: the bundled baseline languages (en, ru) are maintained IN THIS REPO — developers add
// new UI keys to them as they build features. So this script must NOT overwrite them (doing so
// would wipe any key not yet mirrored to the Translations repo). It only pulls the OTHER,
// community-contributed languages, and always keeps en/ru in the picker manifest. The repo's copies
// of en/ru serve purely as the up-to-date template contributors translate from.
//
// Non-fatal by design: if the repo is empty, unreachable, or offline, it logs a warning and leaves
// the committed baseline in place so the build never breaks (also lets CI call it unconditionally).

import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'beacon-launcher/Translations'
const REF = process.env.TRANSLATIONS_REF || 'main'
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}`
// Maintained in-app; never overwritten by the sync.
const BUNDLED = new Set(['en', 'ru'])

const here = dirname(fileURLToPath(import.meta.url))
const LOCALES = join(here, '..', 'src', 'renderer', 'src', 'locales')

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function main() {
  console.log(`[translations] syncing community languages from ${REPO}@${REF} …`)
  // The committed manifest carries the bundled baseline (en, ru) — keep those in the picker
  // regardless of what the remote has.
  const baseline = JSON.parse(await readFile(join(LOCALES, 'index.json'), 'utf8')).languages.filter((l) => BUNDLED.has(l.code))

  const index = await getJson(`${RAW}/index.json`)
  const langs = Array.isArray(index?.languages) ? index.languages : []

  await mkdir(LOCALES, { recursive: true })
  const extra = []
  for (const lang of langs) {
    const code = lang?.code
    if (!code || BUNDLED.has(code)) continue // never touch the in-app baseline
    try {
      const data = await getJson(`${RAW}/${code}/translation.json`)
      await writeFile(join(LOCALES, `${code}.json`), JSON.stringify(data, null, 2) + '\n')
      extra.push(lang)
    } catch (e) {
      console.warn(`[translations] skipped "${code}": ${e.message}`)
    }
  }
  // Manifest = bundled baseline (always) + the community languages we actually fetched.
  const manifest = { languages: [...baseline, ...extra] }
  await writeFile(join(LOCALES, 'index.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[translations] baseline: ${baseline.map((l) => l.code).join(', ')} | community synced: ${extra.map((l) => l.code).join(', ') || '(none)'}`)
}

main().catch((e) => {
  console.warn(`[translations] sync skipped — keeping committed baseline. Reason: ${e.message}`)
  // Never fail the build over translations.
  process.exit(0)
})
