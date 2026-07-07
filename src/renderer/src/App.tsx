import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Account, AccountsState, ContentItem, ContentType, Loader, ModHit, Profile, ProjectDetail, Settings } from './types'

const RANDOM_WORDS = ['Craft', 'Pixel', 'Diamond', 'Creeper', 'Ender', 'Shadow', 'Nova', 'Blaze', 'Frost', 'Turbo', 'Ghost', 'Miner', 'Wolf', 'Fox', 'Storm', 'Titan', 'Cyber', 'Neon', 'Lunar', 'Solar', 'Void', 'Rogue']

function randomUsername(): string {
  const pick = (): string => RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)]
  const num = Math.floor(Math.random() * 100)
  return `${pick()}_${pick()}${num}`.slice(0, 16)
}

const CONSOLE_ART = 'Game output appears here after you press Play.'

// Minecraft's log4j XML layout dumps `<log4j:Event>…</log4j:Event>` blocks. Turn each into a
// readable `[HH:MM:SS] [thread/LEVEL] message` line; drop a trailing incomplete block so the
// raw XML tail never shows.
function cleanConsole(raw: string): string {
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
  // Strip any partial (still-streaming) event at the very end.
  return out.replace(/<log4j:Event\b[\s\S]*$/, '')
}

// Tiny inline spinner for buttons (sits before the label while an action runs).
function Spinner(): React.JSX.Element {
  return <span className="spinner" aria-hidden="true" />
}

// Minimalist indeterminate loading bar — a thin accent sliver sweeping a track.
function LoadingBar(): React.JSX.Element {
  return <div className="loading-bar" role="progressbar" aria-label="Loading" />
}

// Friendly centred empty state — a little kaomoji instead of a dry "nothing found".
function Empty({ hint }: { hint?: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="kao">≧ ﹏ ≦</span>
      {hint && <span className="empty-hint">{hint}</span>}
    </div>
  )
}

// Default profile avatar: one neutral, monochrome placeholder for every profile (a simple
// "no image set" mark) — a clean stand-in meant to be replaced by the user's own icon.
function MonoAvatar({ size }: { size: number }): React.JSX.Element {
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="var(--input)" />
      <circle cx="38" cy="40" r="9" fill="var(--dim)" />
      <path d="M18 78 L44 50 L58 64 L72 52 L86 78 Z" fill="var(--dim)" />
    </svg>
  )
}

function Avatar({ profile, size }: { profile: Profile; size: number }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (profile.avatar) window.beacon.imageDataUrl(profile.avatar).then((u) => alive && setUrl(u))
    else setUrl(null)
    return () => {
      alive = false
    }
  }, [profile.avatar])
  if (url) return <img className="avatar" src={url} width={size} height={size} alt="" />
  return <MonoAvatar size={size} />
}

type Phase = 'idle' | 'install' | 'running'
interface UpdateStatus {
  state: string
  version?: string
  percent?: number
  message?: string
  manual?: boolean
}

const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : `${n}`

// Total playtime → "3h 24m" / "12m", or null when under a minute (nothing to show yet).
function fmtPlaytime(ms?: number): string | null {
  const min = Math.floor((ms ?? 0) / 60000)
  if (min < 1) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const JAVA_KEYS: Record<number, keyof Settings> = { 25: 'java25', 21: 'java21', 17: 'java17', 8: 'java8' }
// Named accent presets shown as preview cards in Settings. "Default" is the neutral white.
const ACCENTS: { label: string; color: string }[] = [
  { label: 'Default', color: '#ffffff' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Red', color: '#ef4444' },
  { label: 'Green', color: '#22c55e' },
  { label: 'Purple', color: '#a78bfa' },
  { label: 'Orange', color: '#f59e0b' },
  { label: 'Sky', color: '#38bdf8' },
  { label: 'Pink', color: '#f472b6' },
  { label: 'Yellow', color: '#eab308' }
]

export default function App(): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // All accounts (offline nicknames + licensed Microsoft) and which is active. Managed from the
  // accounts modal opened via the top bar.
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showAccounts, setShowAccounts] = useState(false)
  const [signingIn, setSigningIn] = useState(false) // true while the Microsoft popup is open
  const activeAccount = accounts.find((a) => a.id === activeId) ?? null
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('Ready')
  const [percent, setPercent] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [showLog, setShowLog] = useState(false)
  const SIDEBAR_MIN = 220
  const SIDEBAR_MAX = 360
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem('beacon.sidebarWidth'))
    return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : 220
  })
  const [resizing, setResizing] = useState(false)
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX)))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      setSidebarWidth((w) => {
        localStorage.setItem('beacon.sidebarWidth', String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const [packDragOver, setPackDragOver] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [toastCopied, setToastCopied] = useState(false)
  const [maxRam, setMaxRam] = useState(8192)
  const [maximized, setMaximized] = useState(false)
  const [pstates, setPstates] = useState<Record<string, { status: string; percent: number; text: string }>>({})
  // When each running profile's session started (Date.now), so playtime can tick live.
  const sessionStartRef = useRef<Record<string, number>>({})
  const [, forceTick] = useState(0)
  // View history is profile-only — modals (settings) are not pages, so back/forward ignore them.
  const [nav, setNav] = useState<{ list: (string | null)[]; idx: number }>({ list: [], idx: -1 })
  const navRef = useRef(nav)
  navRef.current = nav

  const [showInstalls, setShowInstalls] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Content-panel footer info (count + pagination), reported up by ModsPanel.
  const [footer, setFooter] = useState<{ text: string; page: number; pages: number } | null>(null)
  const footerGoto = useRef<(p: number) => void>(() => {})

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId])

  // All install/run state is derived from the per-profile `pstates` map.
  const installs = useMemo(
    () =>
      profiles
        .filter((p) => pstates[p.id]?.status === 'installing')
        .map((p) => ({ id: p.id, name: p.name, percent: pstates[p.id].percent, text: pstates[p.id].text })),
    [profiles, pstates]
  )
  const runningProfile = useMemo(
    () => profiles.find((p) => pstates[p.id]?.status === 'running' || pstates[p.id]?.status === 'launching') ?? null,
    [profiles, pstates]
  )
  const cancelInstall = (id: string): void => {
    window.beacon.cancelInstall(id)
  }

  // While a game runs, re-render every second so the profile's playtime ticks up live.
  useEffect(() => {
    if (!runningProfile) return
    const iv = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [runningProfile])

  // Extra (unsaved) ms for the selected profile if it's mid-session — added on top of the
  // stored total for a live figure; the store catches up when the game exits.
  const selectedLiveMs = selected && sessionStartRef.current[selected.id] ? Date.now() - sessionStartRef.current[selected.id] : 0

  const applyNav = (id: string | null): void => {
    setSelectedId(id)
    setShowSettings(false)
    setShowLog(false)
  }
  const pushNav = (id: string | null): void => {
    const s = navRef.current
    const list = s.list.slice(0, s.idx + 1)
    list.push(id)
    setNav({ list, idx: list.length - 1 })
    applyNav(id)
  }
  const goBack = (): void => {
    const s = navRef.current
    if (s.idx <= 0) return
    setNav({ ...s, idx: s.idx - 1 })
    applyNav(s.list[s.idx - 1])
  }
  const goForward = (): void => {
    const s = navRef.current
    if (s.idx >= s.list.length - 1) return
    setNav({ ...s, idx: s.idx + 1 })
    applyNav(s.list[s.idx + 1])
  }

  useEffect(() => {
    window.beacon.listProfiles().then((ps) => {
      setProfiles(ps)
      // Start on no profile — don't auto-open the first one; the user picks from the sidebar.
      setSelectedId(null)
      setNav({ list: [null], idx: 0 })
    })
    window.beacon.getSettings().then(setSettings)
    const applyAccounts = (s: AccountsState): void => {
      setAccounts(s.accounts)
      setActiveId(s.activeId)
    }
    window.beacon.listAccounts().then(applyAccounts)
    // authChanged fires on add/switch/remove AND when the main process drops a stale session at
    // launch time — keep the UI in sync either way.
    const offAuthChanged = window.beacon.onAuthChanged(applyAccounts)
    // Mouse back/forward buttons navigate the view history.
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        goBack()
      } else if (e.button === 4) {
        e.preventDefault()
        goForward()
      }
    }
    window.addEventListener('mouseup', onMouse)
    window.beacon.totalRam().then((mb) => setMaxRam(Math.max(2048, Math.floor(mb / 512) * 512)))
    const offStatus = window.beacon.onStatus((s) => {
      setStatus(s.text)
      setPhase(s.phase as Phase)
      if (s.phase !== 'install') setPercent(null)
    })
    const offProgress = window.beacon.onProgress((p) => setPercent(p.percent))
    const offLog = window.beacon.onLog((line) => setLog((prev) => (prev + line).slice(-40000)))
    const offToast = window.beacon.onToast((t) => setToast(t.text))
    const offWinState = window.beacon.onWinState((s) => setMaximized(s.maximized))
    const offPState = window.beacon.onProfileState((s) => {
      setPstates((m) => ({ ...m, [s.id]: { status: s.status, percent: s.percent, text: s.text } }))
      // Stamp when a session starts so the profile page can tick playtime live.
      if (s.status === 'running') {
        if (!sessionStartRef.current[s.id]) sessionStartRef.current[s.id] = Date.now()
      } else {
        delete sessionStartRef.current[s.id]
      }
    })
    // Playtime (and other profile fields) changed in the main process → re-read the list.
    const offProfilesChanged = window.beacon.onProfilesChanged(() => {
      window.beacon.listProfiles().then(setProfiles)
    })
    window.beacon.appVersion().then(setAppVersion)
    const offUpdate = window.beacon.onUpdateStatus(setUpdate)
    return () => {
      offStatus()
      offProgress()
      offLog()
      offToast()
      offWinState()
      offPState()
      offProfilesChanged()
      offUpdate()
      offAuthChanged()
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  // Apply the accent colour. The default (#ffffff) is left to CSS so it can flip per theme
  // (white on dark, dark on light); any custom colour is forced via an inline override.
  useEffect(() => {
    const root = document.documentElement
    const c = (settings?.accentColor || '#ffffff').toLowerCase()
    if (c === '#ffffff') {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--on-accent')
    } else {
      root.style.setProperty('--accent', settings!.accentColor)
      root.style.setProperty('--on-accent', '#0a0a0b')
    }
  }, [settings?.accentColor])

  // Apply the colour theme. 'system' follows the OS via @media in CSS; 'dark'/'light' force it.
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'system'
  }, [settings?.theme])

  useEffect(() => {
    if (settings) window.beacon.discordEnabled(settings.discordRpc !== false)
  }, [settings?.discordRpc])

  // Auto-dismiss toasts; reset the "copied" hint whenever a new one appears.
  useEffect(() => {
    if (!toast) return
    setToastCopied(false)
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  const copyToast = async (): Promise<void> => {
    if (!toast) return
    try {
      await window.beacon.writeClipboard(toast)
    } catch {
      /* clipboard unavailable — ignore */
    }
    setToastCopied(true)
  }

  // Close the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const refreshProfiles = async (select?: string): Promise<void> => {
    const ps = await window.beacon.listProfiles()
    setProfiles(ps)
    if (select) setSelectedId(select)
    else if (!ps.some((p) => p.id === selectedId)) setSelectedId(ps[0]?.id ?? null)
  }

  const commitRename = async (): Promise<void> => {
    if (renamingId) {
      await window.beacon.renameProfile(renamingId, renameValue)
      await refreshProfiles()
    }
    setRenamingId(null)
  }

  const drop = async (targetId: string): Promise<void> => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const ids = profiles.map((p) => p.id)
    const fi = ids.indexOf(dragId)
    const ti = ids.indexOf(targetId)
    ids.splice(ti, 0, ids.splice(fi, 1)[0])
    setProfiles(ids.map((id) => profiles.find((p) => p.id === id)!).filter(Boolean))
    await window.beacon.reorderProfiles(ids)
    setDragId(null)
  }

  const busy = !!runningProfile

  const saveSettings = (s: Settings): void => {
    setSettings(s)
    window.beacon.saveSettings(s)
  }

  const applyAccounts = (s: AccountsState): void => {
    setAccounts(s.accounts)
    setActiveId(s.activeId)
  }
  // Open the Microsoft login popup (main process). Resolves when the whole chain finishes.
  const addAccount = async (): Promise<void> => {
    if (signingIn) return
    setSigningIn(true)
    const r = await window.beacon.signIn()
    setSigningIn(false)
    if (r.ok && r.list) applyAccounts(r.list)
    else if (r.error && r.error !== 'cancelled') setToast(r.error)
  }
  const addOfflineAccount = async (name: string): Promise<void> => {
    applyAccounts(await window.beacon.addOfflineAccount(name))
  }
  const renameAccount = async (id: string, name: string): Promise<void> => {
    applyAccounts(await window.beacon.renameAccount(id, name))
  }
  const switchAccount = async (id: string | null): Promise<void> => {
    applyAccounts(await window.beacon.setActiveAccount(id))
  }
  const removeAccount = async (id: string): Promise<void> => {
    applyAccounts(await window.beacon.removeAccount(id))
  }

  const play = async (): Promise<void> => {
    if (!selected) return
    const r = await window.beacon.launch(selected.id)
    if (!r.ok && r.error) setToast(r.error)
  }

  const del = async (id: string): Promise<void> => {
    await window.beacon.deleteProfile(id)
    await refreshProfiles()
  }

  const onUpdateClick = async (): Promise<void> => {
    if (update?.state === 'ready') {
      window.beacon.installUpdate()
      return
    }
    if (update?.state === 'available') {
      const r = await window.beacon.downloadUpdate()
      if (r.manual) setToast('Opening the download page in your browser…')
      else if (!r.ok && r.error) setToast(r.error)
    }
  }

  const runImport = async (file: string): Promise<void> => {
    const r = await window.beacon.importModpack(file)
    if (r.ok && r.id) await refreshProfiles(r.id)
    else if (r.error) setToast(r.error)
  }
  const importPack = async (): Promise<void> => {
    const file = await window.beacon.pickModpack()
    if (file) await runImport(file)
  }
  const dropPack = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setPackDragOver(false)
    const f = Array.from(e.dataTransfer.files).find((x) => /\.mrpack$/i.test(x.name))
    if (!f) return setToast('Drop a .mrpack modpack file')
    await runImport(window.beacon.getPathForFile(f))
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="th-left">
          <button className="nav-btn" disabled={nav.idx <= 0} onClick={goBack} aria-label="Back">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className="nav-btn" disabled={nav.idx >= nav.list.length - 1} onClick={goForward} aria-label="Forward">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div className="th-center">
          <div className="nick-wrap">
            {/* Long identity bar — just the centered nickname + chevron. The account type
                (Microsoft / Offline) is shown inside the accounts switcher. */}
            <button className="nick-bar" onClick={() => setShowAccounts(true)} data-tip="Accounts">
              <span className="nick-name">{activeAccount?.name ?? settings?.username ?? 'Player'}</span>
              <svg className="nick-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {runningProfile && (
              <button className={`dice ${showLog ? 'on' : ''}`} data-tip="Toggle console" onClick={() => setShowLog((v) => !v)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="2.5" />
                  <path d="M7 9l3 3-3 3M13 15h4" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {update && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready') && (
          <div className="th-update">
            {update.state === 'downloading' ? (
              <span className="update-pill downloading">
                <Spinner /> Updating {update.percent ?? 0}%
              </span>
            ) : (
              <button className={`update-pill ${update.state === 'ready' ? 'ready' : ''}`} onClick={onUpdateClick}>
                {update.state === 'ready' ? (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
                    </svg>
                    Restart to update
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                    Update {update.version ? `v${update.version}` : 'available'}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        <div className="win-controls">
          <button className="win-btn" onClick={() => window.beacon.winMinimize()} aria-label="Minimize">
            <svg viewBox="0 0 14 14" width="14" height="14">
              <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button className="win-btn" onClick={() => window.beacon.winMaximize()} aria-label={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? (
              <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="3" y="4.6" width="6.4" height="6.4" />
                <path d="M5 4.6V3h6v6h-1.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 14 14" width="14" height="14">
                <rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            )}
          </button>
          <button className="win-btn close" onClick={() => window.beacon.winClose()} aria-label="Close">
            <svg viewBox="0 0 14 14" width="14" height="14">
              <line x1="3.2" y1="3.2" x2="10.8" y2="10.8" stroke="currentColor" strokeWidth="1.3" />
              <line x1="10.8" y1="3.2" x2="3.2" y2="10.8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      </header>

      <div className="shell">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="profiles">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`profile ${p.id === selectedId ? 'active' : ''} ${dragId === p.id ? 'dragging' : ''}`}
              draggable={renamingId !== p.id}
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(p.id)}
              onDragEnd={() => setDragId(null)}
              onClick={() => renamingId !== p.id && pushNav(p.id === selectedId ? null : p.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: p.id })
              }}
            >
              <Avatar profile={p} size={34} />
              <div className="p-text">
                {renamingId === p.id ? (
                  <input
                    className="p-name-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <span className="p-name">{p.name}</span>
                )}
                <span className="p-meta">
                  {pstates[p.id]?.status === 'installing'
                    ? `Installing… ${pstates[p.id].percent}%`
                    : `${p.loader} ${p.mcVersion}`}
                </span>
              </div>
            </div>
          ))}
          </div>

          <button
            className={`import-btn ${packDragOver ? 'dragover' : ''}`}
            onClick={importPack}
            data-tip="Import a .mrpack modpack — or drop one here"
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault()
                if (!packDragOver) setPackDragOver(true)
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setPackDragOver(false)
            }}
            onDrop={dropPack}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v11m0 0l-4-4m4 4l4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="lbl">{packDragOver ? 'Drop to import' : 'Import modpack'}</span>
          </button>

          <div className="side-foot">
            <button className="new" onClick={() => setCreating(true)} data-tip="New profile">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span className="lbl">New profile</span>
            </button>
            <button className="gear" onClick={() => { setShowLog(false); setShowSettings(true) }} data-tip="Settings">
              <GearIcon />
            </button>
          </div>
        </aside>

        <div
          className={`sidebar-resize ${resizing ? 'dragging' : ''}`}
          onMouseDown={startResize}
          title="Drag to resize"
        />

      <main className="main">
        {selected ? (
          <ProfileView
            profile={selected}
            state={pstates[selected.id]}
            blocked={!!runningProfile && runningProfile.id !== selected.id}
            liveMs={selectedLiveMs}
            onPlay={play}
            onStop={() => window.beacon.stop()}
            onCancel={() => cancelInstall(selected.id)}
            onError={setToast}
            onRename={async (name) => {
              await window.beacon.renameProfile(selected.id, name)
              await refreshProfiles(selected.id)
            }}
            onFooter={setFooter}
            gotoRef={footerGoto}
          />
        ) : (
          <div className="empty" />
        )}

        {showInstalls && installs.length > 0 && (
          <InstallsPanel installs={installs} onCancel={cancelInstall} onClose={() => setShowInstalls(false)} />
        )}

        {/* Persistent bottom bar — always present; shows counts, download progress and paging. */}
        <footer className="appfoot">
          <span className="af-count">{footer?.text ?? ''}</span>
          {installs.length > 0 &&
            (() => {
              const avg = Math.round(installs.reduce((a, b) => a + b.percent, 0) / installs.length)
              return (
                <button className={`af-progress ${showInstalls ? 'open' : ''}`} onClick={() => setShowInstalls((v) => !v)}>
                  <span className="status-spinner" />
                  <span className="af-prog-text">
                    {installs.length === 1 ? installs[0].text || `Downloading ${installs[0].name}…` : `${installs.length} downloads`}
                  </span>
                  <span className="af-bar">
                    <span className="af-fill" style={{ width: `${avg}%` }} />
                  </span>
                  <span className="af-pct">{avg}%</span>
                </button>
              )
            })()}
          {footer && footer.pages > 1 && (
            <div className="af-pager">
              <button className="nav-btn" disabled={footer.page <= 0} onClick={() => footerGoto.current(footer.page - 1)} aria-label="Previous page">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="af-page">
                {footer.page + 1} / {footer.pages}
              </span>
              <button
                className="nav-btn"
                disabled={footer.page >= footer.pages - 1}
                onClick={() => footerGoto.current(footer.page + 1)}
                aria-label="Next page"
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
        </footer>

        {showLog && (
          <div className="console-page">
            <pre className="console-body">{cleanConsole(log) || CONSOLE_ART}</pre>
          </div>
        )}
      </main>
      </div>

      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const p = profiles.find((x) => x.id === menu.id)
              setRenamingId(menu.id)
              setRenameValue(p?.name ?? '')
              setMenu(null)
            }}
          >
            Rename
          </button>
          <button onClick={() => { window.beacon.openProfileFolder(menu.id); setMenu(null) }}>Open folder</button>
          <button className="danger" onClick={() => { del(menu.id); setMenu(null) }}>
            Delete
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" onClick={copyToast} data-tip="Click to copy">
          <button
            className="toast-x"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation()
              setToast(null)
            }}
          >
            ✕
          </button>
          <div className="toast-msg">{toast}</div>
          <div className="toast-hint">{toastCopied ? '✓ Copied to clipboard' : 'Click to copy'}</div>
        </div>
      )}

      {creating && (
        <CreateProfileModal
          defaultName={`Profile ${profiles.length + 1}`}
          onClose={() => setCreating(false)}
          onCreated={async (p) => {
            setCreating(false)
            await refreshProfiles(p.id)
          }}
        />
      )}

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          maxRam={maxRam}
          appVersion={appVersion}
          update={update}
          onCheckUpdate={async () => {
            const r = await window.beacon.checkUpdate()
            if (r.dev) setToast('Update checks run in the installed app only.')
            else if (!r.ok && r.error) setToast(r.error)
          }}
          onUpdate={onUpdateClick}
          onChange={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAccounts && (
        <AccountsModal
          accounts={accounts}
          activeId={activeId}
          signingIn={signingIn}
          onSelect={switchAccount}
          onAddMicrosoft={addAccount}
          onAddOffline={addOfflineAccount}
          onRename={renameAccount}
          onRemove={removeAccount}
          onClose={() => setShowAccounts(false)}
        />
      )}

      <Tooltip />
    </div>
  )
}

// Minimalist custom tooltip. Any element with a `data-tip` attribute shows it on hover; a single
// fixed-position node (body-level) is reused, so it never clips inside scroll containers.
function Tooltip(): React.JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const elRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const target = (e: Event): HTMLElement | null =>
      (e.target instanceof Element ? e.target.closest('[data-tip]') : null) as HTMLElement | null
    const hide = (): void => {
      elRef.current = null
      setTip(null)
    }
    const show = (el: HTMLElement): void => {
      const text = el.getAttribute('data-tip')
      if (!text) return
      const r = el.getBoundingClientRect()
      // Adaptive: prefer above, but drop below when there isn't room above the target.
      const below = r.top < 44
      elRef.current = el
      const x = Math.min(Math.max(r.left + r.width / 2, 56), window.innerWidth - 56)
      setTip({ text, x: Math.round(x), y: Math.round(below ? r.bottom : r.top), below })
    }
    const onOver = (e: MouseEvent): void => {
      const el = target(e)
      if (el) show(el)
    }
    const onOut = (e: MouseEvent): void => {
      if (target(e)) hide()
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    // Any click, or a scroll, dismisses — and covers the case where the hovered element is
    // removed from the DOM (e.g. deleting an account) so no mouseout ever fires.
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('scroll', hide, true)
    // Safety net: if the anchored element is gone, drop the tooltip.
    const iv = setInterval(() => {
      if (elRef.current && !elRef.current.isConnected) hide()
    }, 200)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('scroll', hide, true)
      clearInterval(iv)
    }
  }, [])
  if (!tip) return null
  return (
    <div className={`tooltip ${tip.below ? 'below' : ''}`} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  )
}

// Account switcher, opened from the top bar. Lists every account (offline nicknames + licensed
// Microsoft) and lets the user switch active, rename/remove, or add more of either kind.
function AccountsModal({
  accounts,
  activeId,
  signingIn,
  onSelect,
  onAddMicrosoft,
  onAddOffline,
  onRename,
  onRemove,
  onClose
}: {
  accounts: Account[]
  activeId: string | null
  signingIn: boolean
  onSelect: (id: string) => void
  onAddMicrosoft: () => void
  onAddOffline: (name: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [newNick, setNewNick] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const addOffline = (): void => {
    const n = newNick.trim()
    if (!n) return
    onAddOffline(n)
    setNewNick('')
  }
  return (
    <Modal title="Accounts" onClose={onClose}>
      <div className="accounts">
        {/* Add section — pinned at the top; only the account list below scrolls. */}
        <div className="acc-add-section">
          <div className="acc-add-field">
            <input
              className="acc-add-input"
              value={newNick}
              maxLength={16}
              placeholder="New offline nickname…"
              onChange={(e) => setNewNick(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addOffline()}
            />
            <button className="in-icon" data-tip="Random nickname" onClick={() => setNewNick(randomUsername())}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="16" cy="8" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="8" cy="16" r="1.4" />
                <circle cx="16" cy="16" r="1.4" />
              </svg>
            </button>
          </div>
          <button className="add-btn" onClick={addOffline} disabled={!newNick.trim()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add offline account
          </button>
          <button className="add-btn ms" onClick={onAddMicrosoft} disabled={signingIn}>
            {signingIn ? (
              <>
                <Spinner /> Waiting for Microsoft…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="3" y="3" width="8" height="8" fill="#f25022" />
                  <rect x="13" y="3" width="8" height="8" fill="#7fba00" />
                  <rect x="3" y="13" width="8" height="8" fill="#00a4ef" />
                  <rect x="13" y="13" width="8" height="8" fill="#ffb900" />
                </svg>
                Add Microsoft account
              </>
            )}
          </button>
        </div>

        <div className="acc-list">
          {accounts.map((a) => {
            const licensed = a.type === 'msa'
            const editing = editingId === a.id
            const active = activeId === a.id
            return (
              <div key={a.id} className={`acc-row ${active ? 'active' : ''}`}>
                <button className="acc-pick" onClick={() => onSelect(a.id)}>
                  <span className="acc-meta">
                    {editing ? (
                      <input
                        className="acc-name-input"
                        autoFocus
                        value={a.name}
                        maxLength={16}
                        placeholder="Nickname…"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onRename(a.id, e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        onBlur={() => setEditingId(null)}
                      />
                    ) : (
                      <span className="acc-name">{a.name}</span>
                    )}
                    <span className="acc-sub">{licensed ? 'Microsoft' : 'Offline'}</span>
                  </span>
                </button>
                <div className="acc-actions">
                  {!licensed && (
                    <button className="plain-icon" data-tip="Rename" onClick={() => setEditingId(editing ? null : a.id)}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                  )}
                  <button className="plain-icon danger" data-tip="Remove" onClick={() => onRemove(a.id)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z" />
    </svg>
  )
}

// ── Profile view ─────────────────────────────────────────────────────────────
function ProfileView({
  profile,
  state,
  blocked,
  liveMs,
  onPlay,
  onStop,
  onCancel,
  onError,
  onRename,
  onFooter,
  gotoRef
}: {
  profile: Profile
  state?: { status: string; percent: number; text: string }
  blocked: boolean
  liveMs: number
  onPlay: () => void
  onStop: () => void
  onCancel: () => void
  onError: (m: string) => void
  onRename: (name: string) => void
  onFooter: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef: React.MutableRefObject<(p: number) => void>
}): React.JSX.Element {
  const status = state?.status
  const pct = state?.percent ?? 0
  const played = fmtPlaytime((profile.playtimeMs ?? 0) + liveMs)
  const [editing, setEditing] = useState(false)
  const [nameVal, setNameVal] = useState(profile.name)
  const startEdit = (): void => {
    setNameVal(profile.name)
    setEditing(true)
  }
  const commit = (): void => {
    setEditing(false)
    const v = nameVal.trim()
    if (v && v !== profile.name) onRename(v)
  }
  return (
    <div className="view">
      <header className="topbar">
        <div className="tb-title">
          {editing ? (
            <input
              className="tb-name-input"
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <h1 className="tb-name">
              {profile.name}
              <button className="tb-edit" data-tip="Rename profile" onClick={startEdit}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </h1>
          )}
          <span className="meta">
            {profile.loader} {profile.mcVersion}
            {played && <span className="playtime">{played} played</span>}
          </span>
        </div>
        <div className="tb-actions">
          <button className="icon-btn" onClick={() => window.beacon.openProfileFolder(profile.id)}>
            Folder
          </button>
          {status === 'installing' ? (
            <button className="play installing" onClick={onCancel} data-tip="Cancel install">
              Installing {pct}% <span className="btn-x">✕</span>
            </button>
          ) : status === 'launching' ? (
            <button className="play" disabled>
              Launching…
            </button>
          ) : status === 'running' ? (
            <button className="play stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button className="play" onClick={onPlay} disabled={blocked} data-tip={blocked ? "Stop the running game first" : undefined}>
              Play
            </button>
          )}
        </div>
      </header>

      <div className="body">
        <ModsPanel profile={profile} onError={onError} onFooter={onFooter} gotoRef={gotoRef} />
      </div>
    </div>
  )
}

// ── Parallel installs popover (opens from the status bar) ─────────────────────
function InstallsPanel({
  installs,
  onCancel,
  onClose
}: {
  installs: { id: string; name: string; percent: number; text: string }[]
  onCancel: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="installs-pop" onClick={(e) => e.stopPropagation()}>
      <div className="installs-head">
        <span>Installing ({installs.length})</span>
        <button className="x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {installs.map((it) => (
        <div className="install-row" key={it.id}>
          <div className="install-info">
            <div className="install-top">
              <span className="install-name">{it.name}</span>
              <span className="install-pct">{it.percent}%</span>
            </div>
            <div className="bar">
              <div className="fill" style={{ width: `${it.percent}%` }} />
            </div>
            <span className="install-detail">{it.text || 'Installing…'}</span>
          </div>
          <button className="install-cancel" data-tip="Cancel install" onClick={() => onCancel(it.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Content / Browse (Modrinth) ──────────────────────────────────────────────
const CONTENT_TABS: { type: ContentType; label: string; singular: string }[] = [
  { type: 'mod', label: 'Mods', singular: 'mod' },
  { type: 'resourcepack', label: 'Resource Packs', singular: 'resource pack' },
  { type: 'datapack', label: 'Data Packs', singular: 'data pack' },
  { type: 'shader', label: 'Shaders', singular: 'shader' }
]
const tabsFor = (loader: string): typeof CONTENT_TABS => (loader === 'vanilla' ? CONTENT_TABS.filter((t) => t.type !== 'mod') : CONTENT_TABS)

function timeAgo(iso: string): string {
  const d = Date.parse(iso)
  if (!d) return ''
  const s = Math.floor((Date.now() - d) / 1000)
  for (const [sec, name] of [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ] as [number, string][]) {
    const n = Math.floor(s / sec)
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

const PAGE = 20

// Very light markdown → plain text for the minimal mod detail page (no HTML injection).
function mdToText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Icon for an installed content row — the mod's Modrinth icon, or a neutral placeholder
// (also used as the fallback when a remote icon fails to load).
function ContentIcon({ url }: { url?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  if (url && !broken) return <img className="crow-icon" src={url} alt="" onError={() => setBroken(true)} />
  return (
    <span className="crow-icon ph">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.3 7L12 12l8.7-5M12 22V12" />
      </svg>
    </span>
  )
}

// Memoised: its props (profile ref + the stable setToast) don't change on progress
// ticks, so the whole browser stops re-rendering while a version downloads.
const ModsPanel = memo(function ModsPanel({
  profile,
  onError,
  onFooter,
  gotoRef
}: {
  profile: Profile
  onError: (m: string) => void
  onFooter: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef: React.MutableRefObject<(p: number) => void>
}): React.JSX.Element {
  const tabs = useMemo(() => tabsFor(profile.loader), [profile.loader])
  const [type, setType] = useState<ContentType>(tabs[0].type)
  const [view, setView] = useState<'content' | 'browse'>('content')
  const [items, setItems] = useState<ContentItem[]>([])
  // Filter + sort for the installed list (client-side).
  const [filter, setFilter] = useState('')
  const [installedSort, setInstalledSort] = useState<'name' | 'author' | 'enabled'>('name')
  // Which installed row's ⋮ menu is open (by filename), if any.
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  // Available updates: filename → newer version number (from Modrinth).
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [updatingName, setUpdatingName] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  // Drag & drop: highlight the list while a file is over it.
  const [dropping, setDropping] = useState(false)
  // browse
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  // Mod detail page (opened by clicking a mod in either list).
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const meta = tabs.find((t) => t.type === type) ?? tabs[0]
  const pages = Math.max(1, Math.ceil(total / PAGE))

  // Guard async enrichment against a type/profile switch landing on the wrong list.
  const typeRef = useRef(type)
  typeRef.current = type

  const refreshItems = (t: ContentType = type): void => {
    window.beacon.listContent(profile.id, t).then((list) => {
      if (typeRef.current === t) setItems(list)
      // Fill in icons / titles / authors / versions from Modrinth (cached after first lookup).
      window.beacon.enrichContent(profile.id, t).then((enriched) => {
        if (typeRef.current === t) setItems(enriched)
      })
    })
  }

  // Ask Modrinth whether any installed item has a newer compatible build (network, on demand).
  const checkUpdatesFor = (t: ContentType = type): void => {
    window.beacon.checkContentUpdates(profile.id, t).then((u) => {
      if (typeRef.current === t) setUpdates(u)
    })
  }

  const doUpdate = async (name: string): Promise<void> => {
    setUpdatingName(name)
    setRowMenu(null)
    const r = await window.beacon.updateContent(profile.id, type, name)
    setUpdatingName(null)
    if (r.ok) {
      setUpdates((u) => {
        const n = { ...u }
        delete n[name]
        return n
      })
      refreshItems()
    } else onError(r.error ?? 'Update failed')
  }

  const updateAll = async (): Promise<void> => {
    setUpdatingAll(true)
    for (const name of Object.keys(updates)) {
      setUpdatingName(name)
      const r = await window.beacon.updateContent(profile.id, type, name)
      if (!r.ok) onError(r.error ?? 'Update failed')
    }
    setUpdatingName(null)
    setUpdatingAll(false)
    setUpdates({})
    refreshItems()
    checkUpdatesFor()
  }

  // Drop files (jars / zips) straight onto the list to add them to this content folder.
  const onDropFiles = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDropping(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.beacon.getPathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    const added = await window.beacon.addContentFiles(profile.id, type, paths)
    if (added.length) refreshItems()
    else onError('No .jar or .zip files to add')
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const arr = q ? items.filter((it) => `${it.title ?? ''} ${it.author ?? ''} ${it.name}`.toLowerCase().includes(q)) : items.slice()
    const key = (it: ContentItem): string => (it.title || it.name).toLowerCase()
    arr.sort((a, b) => {
      if (installedSort === 'author') return (a.author || key(a)).localeCompare(b.author || key(b))
      if (installedSort === 'enabled') return a.enabled === b.enabled ? key(a).localeCompare(key(b)) : a.enabled ? -1 : 1
      return key(a).localeCompare(key(b))
    })
    return arr
  }, [items, filter, installedSort])

  const hasUpdates = Object.keys(updates).length > 0

  // Reset everything when the profile changes.
  useEffect(() => {
    setType(tabsFor(profile.loader)[0].type)
    setView('content')
    setHits([])
    setInstalledIds(new Set())
    setQuery('')
    setFilter('')
    setPage(0)
    setUpdates({})
    setDetail(null)
    setDetailLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  // Load the installed list whenever the type (or profile) changes, then check for updates.
  useEffect(() => {
    setUpdates({})
    refreshItems(type)
    checkUpdatesFor(type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, profile.id])

  // Live browse search: re-query shortly after typing stops — no need to press Enter.
  useEffect(() => {
    if (view !== 'browse') return
    const id = setTimeout(() => {
      setPage(0)
      runSearch(query, sort, type, 0)
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const runSearch = async (q: string, s: string, t: ContentType, p: number): Promise<void> => {
    setLoading(true)
    const r = await window.beacon.searchContent(q, profile.mcVersion, profile.loader, s, t, p * PAGE)
    setLoading(false)
    if (r.ok) {
      setHits(r.hits ?? [])
      setTotal(r.total ?? 0)
    } else {
      setHits([])
      setTotal(0)
      onError(r.error ?? 'Search failed')
    }
  }

  const openBrowse = (): void => {
    setView('browse')
    setPage(0)
    runSearch(query, sort, type, 0)
  }
  const changeTab = (t: ContentType): void => {
    setType(t)
    setFilter('')
    setRowMenu(null)
    if (view === 'browse') {
      setPage(0)
      runSearch(query, sort, t, 0)
    }
  }
  const gotoPage = (p: number): void => {
    const np = Math.max(0, Math.min(pages - 1, p))
    setPage(np)
    runSearch(query, sort, type, np)
  }
  gotoRef.current = gotoPage

  // Report count + pagination up to the app-level persistent footer.
  const inDetail = detailLoading || !!detail
  const footerText = inDetail
    ? detail?.title ?? 'Loading…'
    : view === 'browse'
      ? loading
        ? 'Searching…'
        : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`
      : `${filter ? `${filtered.length} / ${items.length}` : items.length} ${meta.label.toLowerCase()}`
  useEffect(() => {
    onFooter({ text: footerText, page, pages: view === 'browse' && !inDetail ? pages : 1 })
  }, [footerText, page, pages, view, inDetail, onFooter])
  useEffect(() => () => onFooter(null), [onFooter])
  const install = async (h: ModHit): Promise<void> => {
    setBusyId(h.id)
    const r = await window.beacon.installContent(profile.id, h.id, profile.mcVersion, profile.loader, type, {
      title: h.title,
      author: h.author,
      iconUrl: h.iconUrl,
      slug: h.slug
    })
    setBusyId(null)
    if (r.ok) {
      setInstalledIds((s) => new Set(s).add(h.id))
      refreshItems()
    } else onError(r.error ?? 'Install failed')
  }

  const openDetail = async (idOrSlug: string): Promise<void> => {
    setDetail(null)
    setDetailLoading(true)
    const r = await window.beacon.getProject(idOrSlug)
    setDetailLoading(false)
    if (r.ok && r.project) setDetail(r.project)
    else {
      onError(r.error ?? 'Failed to load project')
      setDetailLoading(false)
    }
  }
  const closeDetail = (): void => {
    setDetail(null)
    setDetailLoading(false)
  }
  const installById = async (d: ProjectDetail): Promise<void> => {
    setBusyId(d.id)
    const r = await window.beacon.installContent(profile.id, d.id, profile.mcVersion, profile.loader, type, {
      title: d.title,
      author: d.author,
      iconUrl: d.iconUrl,
      slug: d.slug
    })
    setBusyId(null)
    if (r.ok) {
      setInstalledIds((s) => new Set(s).add(d.id))
      refreshItems()
    } else onError(r.error ?? 'Install failed')
  }

  // Sliding highlight for the segmented pill — measure the active tab and animate a pill
  // behind it. useLayoutEffect positions it before paint so it never flashes from 0.
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [slider, setSlider] = useState({ left: 0, width: 0 })
  useLayoutEffect(() => {
    const el = btnRefs.current[type]
    if (el) setSlider({ left: el.offsetLeft, width: el.offsetWidth })
  }, [type, tabs, view])

  // Close an open row menu on any outside interaction.
  useEffect(() => {
    if (!rowMenu) return
    const close = (): void => setRowMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [rowMenu])

  const TabBar = (
    <div className="ctabs">
      <span className="ctab-slider" style={{ transform: `translateX(${slider.left}px)`, width: slider.width }} />
      {tabs.map((t) => (
        <button
          key={t.type}
          ref={(el) => {
            btnRefs.current[t.type] = el
          }}
          className={`ctab ${type === t.type ? 'on' : ''}`}
          onClick={() => changeTab(t.type)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  // Shared across both views: the tabs plus the Browse / Add manually buttons. In the browse
  // view the Browse button flips to "return to installed" instead of opening the search.
  const TopBar = (
    <div className="mods-topbar">
      {TabBar}
      <div className="content-actions">
        {view === 'content' && hasUpdates && (
          <button className="ghost-btn accent" onClick={updateAll} disabled={updatingAll}>
            {updatingAll ? <Spinner /> : null}
            {updatingAll ? 'Updating…' : `Update all (${Object.keys(updates).length})`}
          </button>
        )}
        <button className={`ghost-btn ${view === 'browse' ? 'on' : ''}`} onClick={() => (view === 'browse' ? setView('content') : openBrowse())}>
          Browse
        </button>
        <button className="ghost-btn" onClick={() => window.beacon.openContentFolder(profile.id, type)}>
          Add manually
        </button>
      </div>
    </div>
  )

  // Mod detail page — overlays the panel; sidebar / header / footer stay visible.
  if (inDetail) {
    const installed = detail ? installedIds.has(detail.id) : false
    const busy = detail ? busyId === detail.id : false
    const links: { label: string; url?: string }[] = detail
      ? [
          { label: 'Modrinth', url: `https://modrinth.com/project/${detail.slug}` },
          { label: 'Source', url: detail.source },
          { label: 'Issues', url: detail.issues },
          { label: 'Wiki', url: detail.wiki },
          { label: 'Discord', url: detail.discord }
        ]
      : []
    return (
      <div className="mods">
        <button className="detail-back" onClick={closeDetail}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
        {!detail ? (
          <LoadingBar />
        ) : (
          <div className="detail">
            <div className="detail-head">
              <ContentIcon url={detail.iconUrl} />
              <div className="detail-head-main">
                <h2 className="detail-title">{detail.title}</h2>
                {detail.author && <span className="detail-author">by {detail.author}</span>}
                <p className="detail-desc">{detail.description}</p>
                <div className="detail-stats">
                  <span>↓ {fmt(detail.downloads)}</span>
                  <span>♥ {fmt(detail.follows)}</span>
                  {detail.updated && <span>{timeAgo(detail.updated)}</span>}
                </div>
              </div>
              <button className={`install ${installed ? 'done' : ''}`} onClick={() => installById(detail)} disabled={busy || installed}>
                {busy ? <Spinner /> : null}
                {installed ? '✓ Installed' : busy ? 'Installing…' : 'Install'}
              </button>
            </div>
            {detail.categories.length > 0 && (
              <div className="detail-tags">
                {detail.categories.map((c) => (
                  <span className="tag" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            )}
            <div className="detail-links">
              {links
                .filter((l) => l.url)
                .map((l) => (
                  <button key={l.label} className="detail-link" onClick={() => window.beacon.openUrl(l.url!)}>
                    {l.label}
                  </button>
                ))}
            </div>
            {detail.body && <div className="detail-body">{mdToText(detail.body)}</div>}
          </div>
        )}
      </div>
    )
  }

  if (view === 'content') {
    return (
      <div className="mods">
        {TopBar}

        <div className="mods-bar">
          <div className="search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input placeholder={`Search installed ${meta.label.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <select className="sort" value={installedSort} onChange={(e) => setInstalledSort(e.target.value as typeof installedSort)}>
            <option value="name">Name</option>
            <option value="author">Author</option>
            <option value="enabled">Enabled first</option>
          </select>
        </div>

        <div
          className={`clist ${dropping ? 'dropping' : ''}`}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault()
              if (!dropping) setDropping(true)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
          }}
          onDrop={onDropFiles}
        >
          {dropping && <div className="drop-hint">Drop .jar / .zip files here to add</div>}
          {items.length === 0 ? (
            <Empty hint={`No ${meta.label.toLowerCase()} yet — Browse, drag files here, or Add manually`} />
          ) : filtered.length === 0 ? (
            <Empty />
          ) : (
            filtered.map((it) => {
              // Title / version come straight from Modrinth (no filename parsing). With no match,
              // the filename stands in as the title and the version reads "Unknown".
              const title = it.title || it.name
              const version = it.version || 'Unknown'
              const url = it.slug || it.projectId ? `https://modrinth.com/project/${it.slug || it.projectId}` : null
              const update = updates[it.name]
              const isUpdating = updatingName === it.name
              const projectRef = it.slug || it.projectId
              return (
                <div className={`crow ${it.enabled ? '' : 'off'}`} key={it.name}>
                  <div
                    className={`crow-lead ${projectRef ? 'clickable' : ''}`}
                    onClick={projectRef ? () => openDetail(projectRef) : undefined}
                  >
                    <ContentIcon url={it.iconUrl} />
                    <div className="crow-main">
                      <span className="crow-title" title={title}>
                        {title}
                      </span>
                      {it.author && <span className="crow-author">{it.author}</span>}
                    </div>
                  </div>
                  <div className="crow-ver">
                    <div className="crow-ver-line">
                      <span className={`crow-version ${version === 'Unknown' ? 'unknown' : ''}`}>{version}</span>
                      {(update || isUpdating) && (
                        <button
                          className="crow-update"
                          data-tip={update ? `Update to ${update}` : "Updating…"}
                          disabled={isUpdating}
                          onClick={() => doUpdate(it.name)}
                        >
                          {isUpdating ? <Spinner /> : null}
                          Update
                        </button>
                      )}
                    </div>
                    {it.title && (
                      <span className="crow-file" title={it.name}>
                        {it.name}
                      </span>
                    )}
                  </div>
                  <div className="crow-actions">
                    <button
                      className={`toggle ${it.enabled ? 'on' : ''}`}
                      data-tip={it.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                      onClick={async () => {
                        await window.beacon.toggleContent(profile.id, type, it.name, !it.enabled)
                        refreshItems()
                      }}
                    >
                      <span className="knob" />
                    </button>
                    <button
                      className="crow-del"
                      data-tip="Delete"
                      onClick={async () => {
                        await window.beacon.removeContent(profile.id, type, it.name)
                        refreshItems()
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
                      </svg>
                    </button>
                    <button
                      className="crow-more"
                      data-tip="More"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRowMenu((cur) => (cur === it.name ? null : it.name))
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <circle cx="12" cy="5" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="12" cy="19" r="1.7" />
                      </svg>
                    </button>
                    {rowMenu === it.name && (
                      <div className="row-menu" onClick={(e) => e.stopPropagation()}>
                        {update && (
                          <button onClick={() => doUpdate(it.name)}>Update to {update}</button>
                        )}
                        <button
                          disabled={!url}
                          onClick={() => {
                            if (url) window.beacon.openUrl(url)
                            setRowMenu(null)
                          }}
                        >
                          Open Modrinth page
                        </button>
                        <button
                          onClick={() => {
                            window.beacon.openContentFolder(profile.id, type)
                            setRowMenu(null)
                          }}
                        >
                          Open folder
                        </button>
                        <button
                          className="danger"
                          onClick={async () => {
                            setRowMenu(null)
                            await window.beacon.removeContent(profile.id, type, it.name)
                            refreshItems()
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mods">
      {TopBar}
      <div className="mods-bar">
        <div className="search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            placeholder={`Search ${meta.label.toLowerCase()} with Modrinth...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(0)
                runSearch(query, sort, type, 0)
              }
            }}
          />
        </div>
        <select
          className="sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value)
            setPage(0)
            runSearch(query, e.target.value, type, 0)
          }}
        >
          <option value="relevance">Relevance</option>
          <option value="downloads">Popularity</option>
          <option value="follows">Following</option>
          <option value="newest">Newest</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>

      <div className="cards">
        {loading && <LoadingBar />}
        {!loading && hits.length === 0 && <Empty />}
        {!loading &&
          hits.map((h) => {
            const done = installedIds.has(h.id)
            const inProgress = busyId === h.id
            return (
              <div className="card clickable" key={h.id} onClick={() => openDetail(h.slug || h.id)}>
                {h.iconUrl ? <img src={h.iconUrl} alt="" /> : <span className="ph" />}
                <div className="card-body">
                  <div className="card-top">
                    <span className="card-title">{h.title}</span>
                    {h.author && <span className="by">{h.author}</span>}
                  </div>
                  <div className="card-desc">{h.description}</div>
                  <div className="card-tags">
                    <span className="tag">↓ {fmt(h.downloads)}</span>
                    <span className="tag">♥ {fmt(h.follows)}</span>
                    {h.updated && <span className="tag muted">{timeAgo(h.updated)}</span>}
                  </div>
                </div>
                <button
                  className={`install ${done ? 'done' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    install(h)
                  }}
                  disabled={inProgress || done}
                >
                  {inProgress ? <Spinner /> : null}
                  {done ? '✓ Installed' : inProgress ? 'Installing…' : 'Install'}
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
})

// ── Custom colour picker (app-styled HSV popover) ────────────────────────────
function hexToHsv(hex: string): { h: number; s: number; v: number } {
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

function hsvToHex(h: number, s: number, v: number): string {
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

function ColorPicker({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }): React.JSX.Element {
  const parsed = hexToHsv(value)
  const [hue, setHue] = useState(parsed.h)
  const { s, v } = parsed
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const dragOn = (ref: React.RefObject<HTMLDivElement | null>, handler: (nx: number, ny: number) => void) => (e: React.PointerEvent): void => {
    const apply = (cx: number, cy: number): void => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      handler(Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height)))
    }
    apply(e.clientX, e.clientY)
    const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onSV = dragOn(svRef, (nx, ny) => onChange(hsvToHex(hue, nx, 1 - ny)))
  const onHue = dragOn(hueRef, (nx) => {
    const nh = nx * 360
    setHue(nh)
    onChange(hsvToHex(nh, s || 1, v || 1))
  })

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.cpick') && !(e.target as HTMLElement).closest('.accent-card.custom')) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])

  return (
    <div className="cpick" onClick={(e) => e.stopPropagation()}>
      <div
        className="cpick-sv"
        ref={svRef}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hue, 1, 1)})` }}
        onPointerDown={onSV}
      >
        <span className="cpick-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div className="cpick-hue" ref={hueRef} onPointerDown={onHue}>
        <span className="cpick-dot hue" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <div className="cpick-foot">
        <span className="cpick-preview" style={{ background: value }} />
        <input
          className="cpick-hex"
          value={text}
          onChange={(e) => {
            let t = e.target.value
            if (!t.startsWith('#')) t = `#${t}`
            setText(t)
            if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase())
          }}
        />
      </div>
    </div>
  )
}

// ── Settings modal ───────────────────────────────────────────────────────────
function SettingsModal({
  settings,
  maxRam,
  appVersion,
  update,
  onCheckUpdate,
  onUpdate,
  onChange,
  onClose
}: {
  settings: Settings
  maxRam: number
  appVersion: string
  update: UpdateStatus | null
  onCheckUpdate: () => void
  onUpdate: () => void
  onChange: (s: Settings) => void
  onClose: () => void
}): React.JSX.Element {
  const patch = (p: Partial<Settings>): void => onChange({ ...settings, ...p })
  const mem = Math.min(settings.maxMemory, maxRam)
  const memPct = maxRam > 1024 ? ((mem - 1024) / (maxRam - 1024)) * 100 : 0
  const theme = settings.theme ?? 'system'
  const [pickerOpen, setPickerOpen] = useState(false)
  // "Custom" stays selected while the user is in the custom picker — even if the colour equals a
  // preset — so it's tracked separately from the colour value (and persisted across opens).
  const presetOn = (c: string): boolean => ACCENTS.some((a) => a.color.toLowerCase() === c.toLowerCase())
  const [isCustom, setIsCustomState] = useState(() => localStorage.getItem('beacon.accentCustom') === '1' || !presetOn(settings.accentColor))
  const setCustom = (on: boolean): void => {
    setIsCustomState(on)
    localStorage.setItem('beacon.accentCustom', on ? '1' : '0')
  }
  const pickPreset = (color: string): void => {
    setCustom(false)
    patch({ accentColor: color })
  }
  // Let the memory field be temporarily empty while typing instead of snapping to 0.
  const [memText, setMemText] = useState<string | null>(null)
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings">
        <div className="set-row">
          <div className="set-head">
            <span className="set-title">Theme</span>
            <span className="set-sub">Follow the system, or force dark / light</span>
          </div>
          <div className="theme-grid">
            {(['system', 'dark', 'light'] as const).map((t) => (
              <button key={t} className={`theme-card ${theme === t ? 'on' : ''}`} onClick={() => patch({ theme: t })}>
                <div className={`tc-preview ${t}`}>
                  <span className="tc-side" />
                  <span className="tc-main">
                    <i />
                    <i />
                    <i />
                  </span>
                  {theme === t && (
                    <span className="tc-check">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                  )}
                </div>
                <span className="ac-label">{t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">Accent colour</span>
            <span className="set-sub">Highlights, buttons and progress across the app</span>
          </div>
          <div className="accent-grid">
            {ACCENTS.map((a) => {
              const on = !isCustom && settings.accentColor.toLowerCase() === a.color.toLowerCase()
              return (
                <button
                  key={a.color}
                  className={`accent-card ${on ? 'on' : ''}`}
                  style={{ ['--c' as string]: a.color }}
                  onClick={() => pickPreset(a.color)}
                >
                  <div className="ac-preview">
                    <div className="ac-dots">
                      <span />
                      <span />
                    </div>
                    <div className="ac-lines">
                      <span />
                      <span className="hi" />
                      <span />
                    </div>
                    {on && (
                      <span className="ac-check">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                    )}
                    <span className="ac-bar" />
                  </div>
                  <span className="ac-label">{a.label}</span>
                </button>
              )
            })}
            <div className="accent-custom-wrap">
              <button
                className={`accent-card custom ${isCustom ? 'on' : ''}`}
                style={{ ['--c' as string]: settings.accentColor }}
                onClick={() => {
                  setCustom(true)
                  setPickerOpen((o) => !o)
                }}
              >
                <div className="ac-preview">
                  <span className="ac-plus">+</span>
                  {isCustom && (
                    <span className="ac-check">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                  )}
                  <span className="ac-bar" style={{ background: settings.accentColor }} />
                </div>
                <span className="ac-label">Custom</span>
              </button>
              {pickerOpen && (
                <ColorPicker
                  value={settings.accentColor}
                  onChange={(c) => {
                    setCustom(true)
                    patch({ accentColor: c })
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="set-row inline">
          <div className="set-head">
            <span className="set-title">Discord Rich Presence</span>
            <span className="set-sub">Show which profile you’re playing in Discord</span>
          </div>
          <button
            className={`toggle ${settings.discordRpc ? 'on' : ''}`}
            data-tip={settings.discordRpc ? 'On' : 'Off'}
            onClick={() => patch({ discordRpc: !settings.discordRpc })}
          >
            <span className="knob" />
          </button>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">Memory</span>
            <span className="set-sub">{maxRam} MB available on this machine</span>
          </div>
          <div className="mem-row">
            <input
              type="range"
              className="filled"
              min={1024}
              max={maxRam}
              step={128}
              value={mem}
              style={{ ['--fill' as string]: `${memPct}%` }}
              onChange={(e) => patch({ maxMemory: Number(e.target.value) })}
            />
            <div className="mem-input">
              <input
                type="number"
                min={1024}
                max={maxRam}
                step={512}
                value={memText ?? mem}
                onChange={(e) => {
                  const raw = e.target.value
                  setMemText(raw) // keep whatever is typed, including empty
                  const v = Number(raw)
                  if (raw !== '' && !Number.isNaN(v)) patch({ maxMemory: v })
                }}
                onBlur={() => {
                  // Commit: empty / invalid falls back to the current value, then clamp + snap.
                  const v = memText === '' || memText === null || Number.isNaN(Number(memText)) ? mem : Number(memText)
                  patch({ maxMemory: Math.max(1024, Math.min(maxRam, Math.round(v / 512) * 512)) })
                  setMemText(null)
                }}
              />
              <span className="mem-unit">MB</span>
            </div>
          </div>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">Java</span>
            <span className="set-sub">Leave empty — the right Java auto-downloads per version. Override only for a specific install.</span>
          </div>
          <div className="jslots">
            {[25, 21, 17, 8].map((major) => (
              <JavaSlot key={major} major={major} value={settings[JAVA_KEYS[major]] as string} onChange={(v) => patch({ [JAVA_KEYS[major]]: v } as Partial<Settings>)} />
            ))}
          </div>
        </div>

        <div className="set-row inline">
          <div className="set-head">
            <span className="set-title">About</span>
            <span className="set-sub">
              Beacon Launcher {appVersion ? `v${appVersion}` : ''}
              {update?.state === 'checking' && ' · checking…'}
              {update?.state === 'available' && ` · v${update.version} available`}
              {update?.state === 'downloading' && ` · downloading ${update.percent ?? 0}%`}
              {update?.state === 'ready' && ` · v${update.version} ready to install`}
              {update?.state === 'none' && ' · up to date'}
            </span>
          </div>
          {update?.state === 'ready' ? (
            <button className="ghost-btn accent" onClick={onUpdate}>
              Restart to update
            </button>
          ) : update?.state === 'available' ? (
            <button className="ghost-btn accent" onClick={onUpdate}>
              Download update
            </button>
          ) : (
            <button className="ghost-btn" onClick={onCheckUpdate} disabled={update?.state === 'checking' || update?.state === 'downloading'}>
              {update?.state === 'checking' ? <Spinner /> : null}
              Check for updates
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function JavaSlot({ major, value, onChange }: { major: number; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<'install' | 'detect' | ''>('')

  const detect = async (): Promise<void> => {
    setBusy('detect')
    const r = await window.beacon.detectJava(major)
    setBusy('')
    if (r.ok && r.path) onChange(r.path)
  }
  const install = async (): Promise<void> => {
    setBusy('install')
    const r = await window.beacon.installJava(major)
    setBusy('')
    if (r.ok && r.path) onChange(r.path)
  }
  const browse = async (): Promise<void> => {
    const j = await window.beacon.pickJava()
    if (j) onChange(j)
  }

  return (
    <div className="jslot">
      <div className="jslot-title">Java {major} location</div>
      <div className="jslot-input">
        <input placeholder="/path/to/java" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className={`jcheck ${value ? 'ok' : 'bad'}`} title={value ? 'Set' : 'Not set'}>
          {value ? '✓' : '✕'}
        </span>
      </div>
      <div className="jslot-btns">
        <button onClick={install} disabled={!!busy || !!value} data-tip={value ? 'Java is already set for this slot' : undefined}>
          {busy === 'install' ? <Spinner /> : null}
          Install recommended
        </button>
        <button onClick={detect} disabled={!!busy}>
          {busy === 'detect' ? <Spinner /> : null}
          Detect
        </button>
        <button onClick={browse} disabled={!!busy}>
          Browse
        </button>
        {value && (
          <button className="jclear" onClick={() => onChange('')} disabled={!!busy}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Create profile ───────────────────────────────────────────────────────────
const LOADERS: { key: Loader; label: string }[] = [
  { key: 'vanilla', label: 'Vanilla' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'quilt', label: 'Quilt' },
  { key: 'neoforge', label: 'NeoForge' },
  { key: 'forge', label: 'Forge' }
]

function CreateProfileModal({
  defaultName,
  onClose,
  onCreated
}: {
  defaultName: string
  onClose: () => void
  onCreated: (p: Profile) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [versions, setVersions] = useState<{ id: string; type: string }[]>([])
  const [version, setVersion] = useState('')
  const [loader, setLoader] = useState<Loader>('fabric')
  // MC versions the chosen loader supports; null = all (vanilla, or still loading).
  const [supported, setSupported] = useState<Set<string> | null>(null)
  // Loader build selection: Stable (installer picks the recommended one) or Latest (newest build).
  const [loaderMode, setLoaderMode] = useState<'stable' | 'latest'>('stable')
  const [builds, setBuilds] = useState<{ version: string; stable: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  useEffect(() => {
    // Fetch every version (releases + snapshots) once; the dropdown filters them.
    window.beacon.listVersions(true).then((vs) => {
      setVersions(vs)
      setVersion((cur) => cur || vs.find((v) => v.type === 'release')?.id || vs[0]?.id || '')
    })
  }, [])

  // Which MC versions this loader supports (null = all).
  useEffect(() => {
    let alive = true
    window.beacon.loaderVersions(loader).then((list) => {
      if (alive) setSupported(list ? new Set(list) : null)
    })
    return () => {
      alive = false
    }
  }, [loader])

  // Only versions the current loader supports (vanilla → all).
  const available = useMemo(
    () => (supported ? versions.filter((v) => supported.has(v.id)) : versions),
    [versions, supported]
  )

  // If the picked version isn't offered by the loader, jump to the newest one that is.
  useEffect(() => {
    if (!supported || !versions.length) return
    if (version && supported.has(version)) return
    const next = available.find((v) => v.type === 'release')?.id ?? available[0]?.id ?? ''
    if (next) setVersion(next)
  }, [supported, versions, available, version])

  // Load the loader's build list (used to resolve "Latest") when the loader or MC version changes.
  useEffect(() => {
    if (loader === 'vanilla' || !version) {
      setBuilds([])
      return
    }
    let alive = true
    window.beacon.loaderBuilds(loader, version).then((b) => {
      if (alive) setBuilds(b)
    })
    return () => {
      alive = false
    }
  }, [loader, version])

  const create = async (): Promise<void> => {
    if (!version) return
    // Stable → let the installer pick the recommended build; Latest → pin the newest.
    const loaderVersion = loader === 'vanilla' || loaderMode === 'stable' ? undefined : builds[0]?.version
    setSaving(true)
    const p = await window.beacon.addProfile(name, version, loader, loaderVersion, avatarSrc ?? undefined)
    setSaving(false)
    onCreated(p)
  }

  return (
    <Modal
      title="New profile"
      onClose={onClose}
      footer={
        <>
          <button className="side-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="play" onClick={create} disabled={saving || !version}>
            {saving ? (
              <>
                <Spinner /> Creating
              </>
            ) : (
              'Create'
            )}
          </button>
        </>
      }
    >
      <div className="avatar-picker">
        {avatarPreview ? <img className="avatar lg" src={avatarPreview} alt="" /> : <MonoAvatar size={62} />}
        <div className="ap-btns">
          <button
            className="ghost-btn"
            onClick={async () => {
              const p = await window.beacon.pickImage()
              if (p) {
                setAvatarSrc(p)
                setAvatarPreview(await window.beacon.imageDataUrl(p))
              }
            }}
          >
            Select icon
          </button>
          <button
            className="ghost-btn subtle"
            disabled={!avatarSrc}
            onClick={() => {
              setAvatarSrc(null)
              setAvatarPreview(null)
            }}
          >
            Remove icon
          </button>
        </div>
      </div>

      <label className="field">
        <span>Name</span>
        <input placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Loader</span>
        <div className="loaders">
          {LOADERS.map((l) => (
            <button key={l.key} className={`loader-btn ${loader === l.key ? 'on' : ''}`} onClick={() => setLoader(l.key)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Game version</span>
        <VersionDropdown versions={available} value={version} onChange={setVersion} />
      </div>
      {loader !== 'vanilla' && (
        <div className="field">
          <span>Loader version</span>
          <div className="loaders">
            {(['stable', 'latest'] as const).map((m) => (
              <button key={m} className={`loader-btn ${loaderMode === m ? 'on' : ''}`} onClick={() => setLoaderMode(m)}>
                {m === 'stable' ? 'Stable' : 'Latest'}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function VersionDropdown({ versions, value, onChange }: { versions: { id: string; type: string }[]; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const list = versions.filter((v) => (showAll || v.type === 'release') && v.id.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="vd" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="vd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{value || 'Select a version'}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="vd-panel up">
          <input className="vd-search" placeholder="Search versions…" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="vd-list">
            {list.length === 0 && <div className="vd-empty">≧ ﹏ ≦</div>}
            {list.map((v) => (
              <button
                type="button"
                key={v.id}
                className={`vd-item ${v.id === value ? 'on' : ''}`}
                onClick={() => {
                  onChange(v.id)
                  setOpen(false)
                }}
              >
                <span>{v.id}</span>
              </button>
            ))}
          </div>
          <button type="button" className="vd-showall" onClick={() => setShowAll((s) => !s)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {showAll ? 'Show release versions' : 'Show all versions'}
          </button>
        </div>
      )}
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
