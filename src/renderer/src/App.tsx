import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, AccountsState, Profile, Settings } from './types'
import { cleanConsole, CONSOLE_ART_KEY, JAVA_KEYS } from './helpers'
import { t, setLanguage } from './i18n'
import { Tooltip } from './components/Modal'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ProfileView } from './components/ProfileView'
import { InstallsPanel } from './components/InstallsPanel'
import { AccountsModal } from './components/AccountsModal'
import { SettingsModal } from './components/SettingsModal'
import { CreateProfileModal } from './components/CreateProfileModal'
import { HomeView } from './components/HomeView'

type Phase = 'idle' | 'install' | 'running'
interface UpdateStatus {
  state: string
  version?: string
  percent?: number
  message?: string
  manual?: boolean
}

export default function App(): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailBack, setDetailBack] = useState<null | (() => void)>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showAccounts, setShowAccounts] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const activeAccount = accounts.find((a) => a.id === activeId) ?? null
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState(t('ready'))
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
  const sessionStartRef = useRef<Record<string, number>>({})
  const [, forceTick] = useState(0)
  const [nav, setNav] = useState<{ list: (string | null)[]; idx: number }>({ list: [], idx: -1 })
  const navRef = useRef(nav)
  navRef.current = nav

  const [showInstalls, setShowInstalls] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [footer, setFooter] = useState<{ text: string; page: number; pages: number } | null>(null)
  const footerGoto = useRef<(p: number) => void>(() => {})
  const [pageInput, setPageInput] = useState('')

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId])

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

  useEffect(() => {
    if (!runningProfile) return
    const iv = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [runningProfile])

  const selectedLiveMs = selected && sessionStartRef.current[selected.id] ? Date.now() - sessionStartRef.current[selected.id] : 0

  // A content/modpack detail page registers its "close" here so the top-bar Back arrow closes the
  // detail first (there's no in-page Back button anymore) before falling back to profile navigation.
  const registerDetailBack = useCallback((fn: (() => void) | null) => setDetailBack(() => fn), [])

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
    // A detail page open? Close that first (it has no in-page Back button).
    if (detailBack) {
      detailBack()
      return
    }
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
      setSelectedId(null)
      setNav({ list: [null], idx: 0 })
    })
    window.beacon.getSettings().then(async (s) => {
      setSettings(s)
      // First run: if no Java slot is set at all, auto-detect installed JDKs once and fill the
      // empty slots, so an existing system Java is preferred over downloading Mojang's runtime.
      // Never touches a slot the user has already set.
      const majors = [8, 17, 21, 25]
      if (majors.every((m) => !s[JAVA_KEYS[m]])) {
        const found = await window.beacon.detectAllJava(majors)
        const patch: Partial<Settings> = {}
        for (const m of majors) if (found[m]) patch[JAVA_KEYS[m]] = found[m] as never
        if (Object.keys(patch).length) {
          const next = { ...s, ...patch }
          setSettings(next)
          window.beacon.saveSettings(next)
        }
      }
    })
    const applyAccounts = (s: AccountsState): void => {
      setAccounts(s.accounts)
      setActiveId(s.activeId)
    }
    window.beacon.listAccounts().then(applyAccounts)
    const offAuthChanged = window.beacon.onAuthChanged(applyAccounts)
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
      if (s.status === 'running') {
        if (!sessionStartRef.current[s.id]) sessionStartRef.current[s.id] = Date.now()
      } else {
        delete sessionStartRef.current[s.id]
      }
    })
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

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'system'
  }, [settings?.theme])

  useEffect(() => {
    if (settings) window.beacon.discordEnabled(settings.discordRpc !== false)
  }, [settings?.discordRpc])

  useEffect(() => {
    if (settings?.language) setLanguage(settings.language)
  }, [settings?.language])

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
      /* clipboard unavailable */
    }
    setToastCopied(true)
  }

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
    // Ignore an empty/whitespace name (e.g. field cleared then clicked away) — keep the old name.
    if (renamingId && renameValue.trim()) {
      await window.beacon.renameProfile(renamingId, renameValue.trim())
      await refreshProfiles()
    }
    setRenamingId(null)
  }
  // Escape: leave edit mode without saving.
  const cancelRename = (): void => setRenamingId(null)

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
      if (r.manual) setToast(t('openingDownloadPage'))
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
    if (!f) return setToast(t('dropMrpack'))
    await runImport(window.beacon.getPathForFile(f))
  }

  const handleSidebarSelect = (id: string): void => {
    pushNav(id === selectedId ? null : id)
  }

  return (
    <div className="app">
      <Header
        navIdx={nav.idx}
        navLen={nav.list.length}
        canBack={detailBack !== null || nav.idx > 0}
        goBack={goBack}
        goForward={goForward}
        activeAccountName={activeAccount?.name ?? null}
        username={settings?.username ?? null}
        showLog={showLog}
        setShowLog={setShowLog}
        runningProfile={runningProfile}
        update={update}
        maximized={maximized}
        onAccountsClick={() => setShowAccounts(true)}
        onUpdateClick={onUpdateClick}
      />

      <div className="shell">
        <Sidebar
          profiles={profiles}
          selectedId={selectedId}
          pstates={pstates}
          sidebarWidth={sidebarWidth}
          onResize={startResize}
          onSelect={handleSidebarSelect}
          onContextMenu={(e, id) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, id })
          }}
          dragId={dragId}
          setDragId={setDragId}
          drop={drop}
          onNewProfile={() => setCreating(true)}
          onSettings={() => { setShowLog(false); setShowSettings(true) }}
          packDragOver={packDragOver}
          setPackDragOver={setPackDragOver}
          importPack={importPack}
          dropPack={dropPack}
          renamingId={renamingId}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          commitRename={commitRename}
          cancelRename={cancelRename}
          onHome={() => pushNav(null)}
          atHome={selectedId === null}
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
            onDetailBack={registerDetailBack}
          />
        ) : (
          <HomeView
            profiles={profiles}
            userName={activeAccount?.name ?? settings?.username ?? 'Player'}
            onError={setToast}
            onCreated={async (p) => {
              await refreshProfiles(p.id)
              pushNav(p.id)
            }}
            onFooter={setFooter}
            gotoRef={footerGoto}
            onDetailBack={registerDetailBack}
          />
        )}

        {showInstalls && installs.length > 0 && (
          <InstallsPanel installs={installs} onCancel={cancelInstall} onClose={() => setShowInstalls(false)} />
        )}

        <footer className="appfoot">
          <span className="af-count">{footer?.text ?? ''}</span>
          {installs.length > 0 &&
            (() => {
              const avg = Math.round(installs.reduce((a, b) => a + b.percent, 0) / installs.length)
              return (
                <button className={`af-progress ${showInstalls ? 'open' : ''}`} onClick={() => setShowInstalls((v) => !v)}>
                  <span className="status-spinner" />
                  <span className="af-prog-text">
                    {installs.length === 1 ? installs[0].text || `${t('installing')} ${installs[0].name}…` : `${installs.length} ${t('downloads')}`}
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
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <input
                className="af-page-input"
                type="text"
                value={pageInput || String(footer.page + 1)}
                onFocus={() => setPageInput(String(footer.page + 1))}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '')
                  setPageInput(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const n = parseInt(pageInput, 10)
                    if (!isNaN(n)) footerGoto.current(n - 1)
                    setPageInput('')
                    ;(e.target as HTMLInputElement).blur()
                  }
                  if (e.key === 'Escape') {
                    setPageInput('')
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                onBlur={() => setPageInput('')}
              />
              <span className="af-page-sep">/</span>
              <span className="af-page-total">{footer.pages}</span>
              <button
                className="nav-btn"
                disabled={footer.page >= footer.pages - 1}
                onClick={() => footerGoto.current(footer.page + 1)}
                aria-label="Next page"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
        </footer>

        {showLog && (
          <div className="console-page">
            <pre className="console-body">{cleanConsole(log) || t(CONSOLE_ART_KEY)}</pre>
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
            {t('rename')}
          </button>
          <button onClick={() => { window.beacon.openProfileFolder(menu.id); setMenu(null) }}>{t('openFolder')}</button>
          <button className="danger" onClick={() => { del(menu.id); setMenu(null) }}>
            {t('delete')}
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" onClick={copyToast} data-tip={t('clickToCopy')}>
          <button
            className="toast-x"
            aria-label={t('dismiss')}
            onClick={(e) => {
              e.stopPropagation()
              setToast(null)
            }}
          >
            ✕
          </button>
          <div className="toast-msg">{toast}</div>
          <div className="toast-hint">{toastCopied ? t('copiedToClipboard') : t('clickToCopy')}</div>
        </div>
      )}

      {creating && (
        <CreateProfileModal
          defaultName={`${t('profileDefault')} ${profiles.length + 1}`}
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
            if (r.dev) setToast(t('updateDevOnly'))
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
          onRemove={removeAccount}
          onClose={() => setShowAccounts(false)}
        />
      )}

      {!settings && (
        <div className="app-splash">
          <div className="dot big" />
          <span className="splash-spin" />
        </div>
      )}

      <Tooltip />
    </div>
  )
}
