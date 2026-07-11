import { basename, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { open, readAllEntries, readEntry } from '@xmcl/unzip'
import { instanceDir, getProfile } from './store'

// Catch the mod-incompatibility crashes users otherwise only see as a Fabric stack trace on launch
// (e.g. "Sodium is incompatible with Iris 1.10.7 or earlier"). Two layers feed the same conflict
// modal in the UI:
//   1. checkConflicts()  — a PRE-LAUNCH static check: read each enabled jar's fabric/quilt manifest,
//      evaluate its `breaks`/`depends` version ranges against the other installed mods (+ Minecraft
//      and the loader), and report before the game ever starts. Catches the version-range conflicts
//      Modrinth's project-level `incompatible` metadata (mods.ts) can't express.
//   2. parseFabricCrash() — a SAFETY NET: turn a Fabric "Incompatible mods found!" crash log into
//      the same structured conflict, since no static check catches everything (runtime conflicts,
//      loaders/formats we don't parse).
// Both are deliberately conservative: an unparseable version range is treated as "no conflict" so a
// weird-but-valid setup is never wrongly blocked, and the modal always offers "launch anyway".

export interface ConflictMod {
  id: string
  name: string
  filename?: string // on-disk jar in the profile's mods folder (present ⇒ we can offer to disable it)
}
export interface Conflict {
  kind: 'breaks' | 'version' | 'crash'
  message: string
  mods: ConflictMod[] // the mods involved; those with a filename can be disabled from the modal
}

// ── version-range matching (Fabric predicate subset) ─────────────────────────
// Fabric version ranges are a semver-ish predicate language. We support the operators that show up
// in real manifests: * / x wildcards, >= <= > < =, ~ (same minor), ^ (same major), whitespace = AND,
// array = OR. Build metadata (+mc1.21.11) is ignored; a leading pre-release (-beta) sorts below its
// release. Anything we can't parse is treated as satisfied so we never invent a conflict.

function parseVer(v: string): { nums: number[]; pre: string } {
  const core = String(v).split('+')[0].trim()
  const dash = core.indexOf('-')
  const main = dash >= 0 ? core.slice(0, dash) : core
  const pre = dash >= 0 ? core.slice(dash + 1) : ''
  const nums = main.split('.').map((n) => {
    const x = parseInt(n, 10)
    return Number.isFinite(x) ? x : 0
  })
  return { nums, pre }
}

function cmp(a: string, b: string): number {
  const A = parseVer(a)
  const B = parseVer(b)
  const len = Math.max(A.nums.length, B.nums.length)
  for (let i = 0; i < len; i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  // A release outranks a pre-release of the same core; otherwise compare pre-release tags as strings.
  if (A.pre && !B.pre) return -1
  if (!A.pre && B.pre) return 1
  if (A.pre === B.pre) return 0
  return A.pre < B.pre ? -1 : 1
}

// One predicate token (no whitespace) against a concrete version. Throws on anything unrecognised so
// the caller can decide (we treat throw = satisfied). `*`/`x` wildcards and ~/^ are range sugar.
function matchToken(token: string, v: string): boolean {
  const p = token.trim()
  if (!p || p === '*') return true
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(p)
  if (!m) throw new Error('bad predicate')
  const op = m[1] || '='
  const ver = m[2].trim()

  // Wildcard match (1.21.x / 1.*): only meaningful with = / no operator.
  if (/[x*]/i.test(ver)) {
    if (op !== '=') throw new Error('wildcard with operator')
    const segs = ver.split('.')
    const vn = parseVer(v).nums
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i].toLowerCase()
      if (s === 'x' || s === '*') continue
      const n = parseInt(s, 10)
      if (!Number.isFinite(n)) throw new Error('bad wildcard segment')
      if ((vn[i] || 0) !== n) return false
    }
    return true
  }

  if (!/^\d/.test(ver)) throw new Error('non-numeric version')
  const c = cmp(v, ver)
  switch (op) {
    case '>=':
      return c >= 0
    case '<=':
      return c <= 0
    case '>':
      return c > 0
    case '<':
      return c < 0
    case '=':
      return c === 0
    case '~': {
      // >= ver and < next-minor
      const n = parseVer(ver).nums
      const upper = `${n[0] || 0}.${(n[1] || 0) + 1}.0`
      return c >= 0 && cmp(v, upper) < 0
    }
    case '^': {
      // >= ver and < next-major
      const n = parseVer(ver).nums
      const upper = `${(n[0] || 0) + 1}.0.0`
      return c >= 0 && cmp(v, upper) < 0
    }
    default:
      throw new Error('unknown operator')
  }
}

// A whole spec (string or array) against a version. Whitespace inside a string ⇒ AND; array ⇒ OR.
// Any parse failure biases to `true` (satisfied) so we never fabricate a conflict from odd input.
function rangeSatisfied(spec: unknown, v: string): boolean {
  if (spec == null) return true
  if (Array.isArray(spec)) return spec.length === 0 || spec.some((s) => rangeSatisfied(s, v))
  if (typeof spec !== 'string') return true
  const tokens = spec.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  try {
    return tokens.every((tk) => matchToken(tk, v))
  } catch {
    return true
  }
}

// ── manifest reading ─────────────────────────────────────────────────────────

interface ModMeta {
  id: string
  name: string
  version: string
  filename: string
  provides: string[]
  depends: Record<string, unknown>
  breaks: Record<string, unknown>
}

// Normalise a Quilt `depends`/`breaks` array (entries are `"id"` or `{ id, versions }`) into the
// flat { id → range } shape Fabric uses. Object/`any`/`all` version forms are skipped (→ satisfied).
function quiltDeps(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!Array.isArray(list)) return out
  for (const e of list) {
    if (typeof e === 'string') out[e] = '*'
    else if (e && typeof e === 'object' && typeof (e as any).id === 'string') {
      const versions = (e as any).versions
      out[(e as any).id] = typeof versions === 'string' ? versions : '*'
    }
  }
  return out
}

// Read one jar's mod manifest (Fabric first, then Quilt). Returns null for jars with neither, an
// unreadable zip, or a dev-placeholder version (contains `$`, e.g. "${version}").
async function readJarMeta(dir: string, filename: string): Promise<ModMeta | null> {
  const zip = await open(join(dir, filename))
  try {
    const entries = await readAllEntries(zip)
    const fabric = entries.find((e) => e.fileName === 'fabric.mod.json')
    if (fabric) {
      const j = JSON.parse((await readEntry(zip, fabric)).toString('utf-8'))
      if (!j.id || typeof j.version !== 'string' || j.version.includes('$')) return null
      return {
        id: j.id,
        name: j.name || j.id,
        version: j.version,
        filename,
        provides: Array.isArray(j.provides) ? j.provides : [],
        depends: j.depends && typeof j.depends === 'object' ? j.depends : {},
        breaks: j.breaks && typeof j.breaks === 'object' ? j.breaks : {}
      }
    }
    const quilt = entries.find((e) => e.fileName === 'quilt.mod.json')
    if (quilt) {
      const j = JSON.parse((await readEntry(zip, quilt)).toString('utf-8'))
      const q = j.quilt_loader
      if (!q || !q.id || typeof q.version !== 'string' || q.version.includes('$')) return null
      const provides = Array.isArray(q.provides)
        ? q.provides.map((p: unknown) => (typeof p === 'string' ? p : (p as any)?.id)).filter(Boolean)
        : []
      return {
        id: q.id,
        name: q.metadata?.name || q.id,
        version: q.version,
        filename,
        provides,
        depends: quiltDeps(q.depends),
        breaks: quiltDeps(q.breaks)
      }
    }
    return null
  } finally {
    zip.close()
  }
}

// ── the pre-launch check ─────────────────────────────────────────────────────

const IGNORED_DEPS = new Set(['java']) // we don't know the JVM major at check time — skip to avoid false positives

/**
 * Statically check an installed Fabric/Quilt profile for the mod conflicts its loader would refuse
 * to launch on: `breaks` ranges that match an installed mod, and `depends` on an installed mod whose
 * version is out of range. MISSING dependencies are intentionally NOT reported — they're routinely
 * satisfied by nested (jar-in-jar) mods we can't see, so flagging them would be a false-positive
 * minefield. Best-effort and non-throwing: any jar that can't be read is skipped.
 */
export async function checkConflicts(profileId: string): Promise<Conflict[]> {
  const profile = getProfile(profileId)
  if (!profile || (profile.loader !== 'fabric' && profile.loader !== 'quilt')) return []
  const dir = join(instanceDir(profileId), 'mods')
  if (!existsSync(dir)) return []
  const jars = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')) // enabled only (.disabled excluded)

  const metas: ModMeta[] = []
  for (const f of jars.slice(0, 500)) {
    try {
      const m = await readJarMeta(dir, f)
      if (m) metas.push(m)
    } catch {
      /* unreadable / not a zip — skip */
    }
  }

  // id (and provided aliases) → installed version + who provides it, for range lookups.
  const provided = new Map<string, { version: string; meta: ModMeta }>()
  for (const m of metas) {
    provided.set(m.id, { version: m.version, meta: m })
    for (const alias of m.provides) if (!provided.has(alias)) provided.set(alias, { version: m.version, meta: m })
  }
  // Pseudo-mods the loader injects, so `depends` on them is checked too.
  const pseudo = new Map<string, string>()
  pseudo.set('minecraft', profile.mcVersion)
  if (profile.loaderVersion) {
    pseudo.set('fabricloader', profile.loaderVersion)
    pseudo.set('quilt_loader', profile.loaderVersion)
  }
  const versionOf = (id: string): string | undefined => provided.get(id)?.version ?? pseudo.get(id)

  const conflicts: Conflict[] = []
  const seen = new Set<string>() // dedupe symmetric pairs (A breaks B ≡ B's row)
  const asMod = (m: ModMeta): ConflictMod => ({ id: m.id, name: m.name, filename: m.filename })

  for (const m of metas) {
    // breaks: an installed mod's version falls inside a range this mod declares incompatible.
    for (const [depId, spec] of Object.entries(m.breaks)) {
      const other = provided.get(depId)
      if (!other || other.meta === m) continue
      if (rangeSatisfied(spec, other.version)) {
        const key = [m.id, other.meta.id].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({
          kind: 'breaks',
          message: `${m.name} (${m.version}) is incompatible with ${other.meta.name} ${other.version}`,
          mods: [asMod(m), asMod(other.meta)]
        })
      }
    }
    // depends: a required mod IS installed but at a version outside the accepted range.
    for (const [depId, spec] of Object.entries(m.depends)) {
      if (IGNORED_DEPS.has(depId)) continue
      const v = versionOf(depId)
      if (v === undefined) continue // missing → skip (see docstring)
      if (!rangeSatisfied(spec, v)) {
        const other = provided.get(depId)
        const otherName = other?.meta.name ?? depId
        const key = `dep:${m.id}:${depId}`
        if (seen.has(key)) continue
        seen.add(key)
        const mods = [asMod(m)]
        if (other && other.meta !== m) mods.push(asMod(other.meta))
        conflicts.push({
          kind: 'version',
          message: `${m.name} (${m.version}) requires ${otherName} ${String(spec)}, but ${v} is installed`,
          mods
        })
      }
    }
  }
  return conflicts
}

// ── crash-log parsing (safety net) ───────────────────────────────────────────

// Fabric's FormattedException prints, per offending mod:
//   - Remove mod 'Iris' (iris) 1.10.7+mc1.21.11 (C:\...\mods\iris-fabric-1.10.7+mc1.21.11.jar).
// and a "More details:" section with the human reason. Turn that into one conflict the modal can act
// on (each parsed mod becomes a disable candidate via its jar basename). Returns null if the log
// isn't a Fabric incompatibility crash.
export function parseFabricCrash(logText: string): Conflict | null {
  if (!/Incompatible mods found!|Some of your mods are incompatible/i.test(logText)) return null
  const mods: ConflictMod[] = []
  const re = /(?:Remove|Replace) mod '([^']+)' \(([^)]+)\)[^\n(]*\(([^)\n]*\.jar)\)/g
  let match: RegExpExecArray | null
  const seen = new Set<string>()
  while ((match = re.exec(logText)) !== null) {
    const filename = basename(match[3].trim())
    if (seen.has(filename)) continue
    seen.add(filename)
    mods.push({ name: match[1], id: match[2], filename })
  }
  if (!mods.length) return null
  // Prefer the concrete "X is incompatible with … Y" detail line as the message.
  const detail = /-\s*Mod '[^']+' \([^)]+\)[^\n]*is incompatible with[^\n]*/i.exec(logText)
  const message = (detail?.[0] ?? 'Some of your mods are incompatible with each other.').replace(/^\s*-\s*/, '').trim()
  return { kind: 'crash', message, mods }
}
