import '../styles/Mods.css'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContentType, ContentSource, ContentItem, ModHit, ProjectDetail, Profile } from '../types'
import { tabsFor, PAGE, fmt, timeAgo } from '../helpers'
import { Spinner, LoadingBar, Empty, ContentIcon, Toggle, Dropdown } from './ui'
import { Markdown } from './Markdown'
import { t } from '../i18n'

export const ModsPanel = memo(function ModsPanel({
  profile,
  onError,
  onFooter,
  gotoRef,
  onDetailBack
}: {
  profile: Profile
  onError: (m: string) => void
  onFooter: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef: React.MutableRefObject<(p: number) => void>
  onDetailBack: (fn: (() => void) | null) => void
  // `lang` isn't used directly — it's here so a language switch changes this component's props
  // and busts React.memo, re-rendering the (otherwise cached) tabs/sort/browse labels in the new
  // language.
  lang?: string
}): React.JSX.Element {
  const tabs = useMemo(() => tabsFor(profile.loader), [profile.loader])
  const [type, setType] = useState<ContentType>(tabs[0].type)
  const [view, setView] = useState<'content' | 'browse'>('content')
  const [items, setItems] = useState<ContentItem[]>([])
  const [filter, setFilter] = useState('')
  const [installedSort, setInstalledSort] = useState<'name' | 'author' | 'enabled'>('name')
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [updatingName, setUpdatingName] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [source, setSource] = useState<ContentSource>('modrinth')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const meta = tabs.find((t) => t.type === type) ?? tabs[0]
  const pages = Math.max(1, Math.ceil(total / PAGE))

  const typeRef = useRef(type)
  typeRef.current = type

  const refreshItems = (ct: ContentType = type): void => {
    window.beacon.listContent(profile.id, ct).then((list) => {
      if (typeRef.current === ct) setItems(list)
      window.beacon.enrichContent(profile.id, ct).then((enriched) => {
        if (typeRef.current === ct) setItems(enriched)
      })
    })
  }

  const checkUpdatesFor = (ct: ContentType = type): void => {
    window.beacon.checkContentUpdates(profile.id, ct).then((u) => {
      if (typeRef.current === ct) setUpdates(u)
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
    } else onError(r.error ?? t('updateFailed'))
  }

  const updateAll = async (): Promise<void> => {
    setUpdatingAll(true)
    for (const name of Object.keys(updates)) {
      setUpdatingName(name)
      const r = await window.beacon.updateContent(profile.id, type, name)
      if (!r.ok) onError(r.error ?? t('updateFailed'))
    }
    setUpdatingName(null)
    setUpdatingAll(false)
    setUpdates({})
    refreshItems()
    checkUpdatesFor()
  }

  const onDropFiles = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDropping(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.beacon.getPathForFile(f))
      .filter(Boolean)
    if (!paths.length) return
    const added = await window.beacon.addContentFiles(profile.id, type, paths)
    if (added.length) refreshItems()
    else onError(t('noJarFiles'))
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

  // Browse cards must reflect what's actually installed on disk, not just what was installed this
  // session. Key by `${source}:${projectId}` so a Modrinth id and a CurseForge id never collide;
  // combined with `updates` (keyed by filename) this drives the Install / Installed / Update state.
  const installedByProject = useMemo(() => {
    const m = new Map<string, ContentItem>()
    for (const it of items) if (it.projectId && it.source) m.set(`${it.source}:${it.projectId}`, it)
    return m
  }, [items])

  // Surface an install's dependency/incompatibility outcome. Incompatible already-installed mods
  // are a real warning (the game may refuse to launch); auto-installed required deps just show up
  // in the list, so we only flag them when there was also a conflict worth reading about.
  const notifyInstall = (r: { installedDeps?: { name: string; title?: string }[]; incompatible?: string[] }): void => {
    if (r.incompatible?.length) onError(t('incompatibleWarning', { mods: r.incompatible.join(', ') }))
  }

  // The Install / Installed / Update button shared by the browse cards and the detail page.
  const renderInstallButton = (id: string, onInstall: () => void, src: ContentSource = source): React.JSX.Element => {
    const it = installedByProject.get(`${src}:${id}`)
    const update = it ? updates[it.name] : undefined
    const inProgress = busyId === id
    const isUpdating = it != null && updatingName === it.name
    if (it && update) {
      return (
        <button
          className="install update"
          data-tip={t('updateTo') + ' ' + update}
          onClick={(e) => {
            e.stopPropagation()
            void doUpdate(it.name)
          }}
          disabled={isUpdating}
        >
          {isUpdating ? <Spinner /> : null}
          {isUpdating ? t('updatingEllipsis') : t('update')}
        </button>
      )
    }
    const done = it != null || installedIds.has(id)
    return (
      <button
        className={`install ${done ? 'done' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onInstall()
        }}
        disabled={inProgress || done}
      >
        {inProgress ? <Spinner /> : null}
        {done ? t('installed') : inProgress ? t('installingEllipsis') : t('install')}
      </button>
    )
  }

  useEffect(() => {
    setType(tabsFor(profile.loader)[0].type)
    setView('content')
    setHits([])
    setInstalledIds(new Set())
    setQuery('')
    setFilter('')
    setPage(0)
    setUpdates({})
    setSource('modrinth')
    setDetail(null)
    setDetailLoading(false)
  }, [profile.id])

  useEffect(() => {
    setUpdates({})
    refreshItems(type)
    checkUpdatesFor(type)
  }, [type, profile.id])

  useEffect(() => {
    if (view !== 'browse') return
    const id = setTimeout(() => {
      setPage(0)
      runSearch(query, sort, type, 0)
    }, 400)
    return () => clearTimeout(id)
  }, [query])

  const runSearch = async (q: string, s: string, ct: ContentType, p: number, src: ContentSource = source): Promise<void> => {
    setLoading(true)
    const r = await window.beacon.searchContent(q, profile.mcVersion, profile.loader, s, ct, p * PAGE, src)
    setLoading(false)
    if (r.ok) {
      setHits(r.hits ?? [])
      setTotal(r.total ?? 0)
    } else {
      setHits([])
      setTotal(0)
      onError(r.error ?? t('searchFailed'))
    }
  }

  const openBrowse = (): void => {
    setView('browse')
    setPage(0)
    runSearch(query, sort, type, 0)
  }
  const changeTab = (ct: ContentType): void => {
    setType(ct)
    setFilter('')
    setRowMenu(null)
    if (view === 'browse') {
      setPage(0)
      runSearch(query, sort, ct, 0)
    }
  }
  const gotoPage = (p: number): void => {
    const np = Math.max(0, Math.min(pages - 1, p))
    setPage(np)
    runSearch(query, sort, type, np)
  }
  gotoRef.current = gotoPage

  const inDetail = detailLoading || !!detail
  const footerText = inDetail
    ? detail?.title ?? t('loading')
    : view === 'browse'
      ? loading
        ? t('searching')
        : `${total.toLocaleString()} ${total === 1 ? t('result') : t('results')}`
      : `${filter ? `${filtered.length} / ${items.length}` : items.length} ${t(meta.labelKey).toLowerCase()}`
  useEffect(() => {
    onFooter({ text: footerText, page, pages: view === 'browse' && !inDetail ? pages : 1 })
  }, [footerText, page, pages, view, inDetail, onFooter])
  useEffect(() => () => onFooter(null), [onFooter])

  const install = async (h: ModHit): Promise<void> => {
    setBusyId(h.id)
    const r = await window.beacon.installContent(
      profile.id,
      h.id,
      profile.mcVersion,
      profile.loader,
      type,
      { title: h.title, author: h.author, iconUrl: h.iconUrl, slug: h.slug },
      h.source ?? source
    )
    setBusyId(null)
    if (r.ok) {
      setInstalledIds((s) => new Set(s).add(h.id))
      refreshItems()
      notifyInstall(r)
    } else onError(r.error ?? t('installFailed'))
  }

  const openDetail = async (idOrSlug: string, src: ContentSource = source): Promise<void> => {
    setDetail(null)
    setDetailLoading(true)
    const r = await window.beacon.getProject(idOrSlug, src)
    setDetailLoading(false)
    if (r.ok && r.project) setDetail(r.project)
    else {
      onError(r.error ?? t('failedToLoadProject'))
      setDetailLoading(false)
    }
  }
  const closeDetail = (): void => {
    setDetail(null)
    setDetailLoading(false)
  }
  // The content detail page has no in-page Back button — the top-bar Back arrow closes it.
  useEffect(() => {
    onDetailBack(inDetail ? closeDetail : null)
    return () => onDetailBack(null)
  }, [inDetail, onDetailBack])
  const installById = async (d: ProjectDetail): Promise<void> => {
    setBusyId(d.id)
    const r = await window.beacon.installContent(
      profile.id,
      d.id,
      profile.mcVersion,
      profile.loader,
      type,
      { title: d.title, author: d.author, iconUrl: d.iconUrl, slug: d.slug },
      d.origin ?? source
    )
    setBusyId(null)
    if (r.ok) {
      setInstalledIds((s) => new Set(s).add(d.id))
      refreshItems()
      notifyInstall(r)
    } else onError(r.error ?? t('installFailed'))
  }

  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [slider, setSlider] = useState({ left: 0, width: 0 })
  useLayoutEffect(() => {
    const el = btnRefs.current[type]
    if (el) setSlider({ left: el.offsetLeft, width: el.offsetWidth })
  }, [type, tabs, view])

  useEffect(() => {
    if (!rowMenu) return
    const close = (): void => setRowMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [rowMenu])

  const TabBar = (
    <div className="ctabs">
      <span className="ctab-slider" style={{ transform: `translateX(${slider.left}px)`, width: slider.width }} />
      {tabs.map((tab) => (
        <button
          key={tab.type}
          ref={(el) => { btnRefs.current[tab.type] = el }}
          className={`ctab ${type === tab.type ? 'on' : ''}`}
          onClick={() => changeTab(tab.type)}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  )

  const TopBar = (
    <div className="mods-topbar">
      {TabBar}
      <div className="content-actions">
        {view === 'content' && hasUpdates && (
          <button
            className="action-ico accent"
            onClick={updateAll}
            disabled={updatingAll}
            data-tip={t('updateAll') + ' (' + Object.keys(updates).length + ')'}
          >
            {updatingAll ? (
              <Spinner />
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
                </svg>
                <span className="action-badge">{Object.keys(updates).length}</span>
              </>
            )}
          </button>
        )}
        <button
          className={`action-ico ${view === 'browse' ? 'on' : ''}`}
          onClick={() => (view === 'browse' ? setView('content') : openBrowse())}
          data-tip={t('browse')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M16 8l-2.5 5.5L8 16l2.5-5.5z" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          className="action-ico"
          onClick={() => window.beacon.openContentFolder(profile.id, type)}
          data-tip={t('addManually')}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 11v5M9.5 13.5h5" />
          </svg>
        </button>
      </div>
    </div>
  )

  if (inDetail) {
    const links: { label: string; url?: string }[] = detail
      ? [
          {
            label: detail.origin === 'curseforge' ? 'CurseForge' : t('modrinth'),
            url: detail.website ?? (detail.origin === 'curseforge' ? undefined : `https://modrinth.com/project/${detail.slug}`)
          },
          { label: t('source'), url: detail.source },
          { label: t('issues'), url: detail.issues },
          { label: t('wiki'), url: detail.wiki },
          { label: 'Discord', url: detail.discord }
        ]
      : []
    return (
      <div className="mods">
        {!detail ? (
          <LoadingBar />
        ) : (
          <div className="detail">
            <div className="detail-head">
              <ContentIcon url={detail.iconUrl} />
              <div className="detail-head-main">
                <h2 className="detail-title">{detail.title}</h2>
                {detail.author && <span className="detail-author">{t('by')} {detail.author}</span>}
                <p className="detail-desc">{detail.description}</p>
                <div className="detail-stats">
                  <span>↓ {fmt(detail.downloads)}</span>
                  <span>♥ {fmt(detail.follows)}</span>
                  {detail.updated && <span>{timeAgo(detail.updated)}</span>}
                </div>
              </div>
              {renderInstallButton(detail.id, () => installById(detail), detail.origin ?? source)}
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
            {detail.body && <Markdown body={detail.body} className="detail-body" />}
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
            <input placeholder={t('searchInstalled') + ' ' + t(meta.labelKey).toLowerCase() + '…'} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Dropdown
            value={installedSort}
            onChange={(v) => setInstalledSort(v as typeof installedSort)}
            options={[
              { value: 'name', label: t('sortName') },
              { value: 'author', label: t('sortAuthor') },
              { value: 'enabled', label: t('sortEnabledFirst') },
            ]}
          />
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
          {items.length === 0 ? (
            <Empty hint={`${t('noContentPrefix')} ${t(meta.singularKey).toLowerCase()} ${t('noContentSuffix')}`} />
          ) : filtered.length === 0 ? (
            <Empty />
          ) : (
            filtered.map((it) => {
              const title = it.title || it.name
              const version = it.version || t('unknown')
              const isCf = it.source === 'curseforge'
              const url = isCf
                ? it.slug && type === 'mod'
                  ? `https://www.curseforge.com/minecraft/mc-mods/${it.slug}`
                  : null
                : it.slug || it.projectId
                  ? `https://modrinth.com/project/${it.slug || it.projectId}`
                  : null
              const update = updates[it.name]
              const isUpdating = updatingName === it.name
              // For the in-app detail page: Modrinth accepts slug or id; CurseForge needs the numeric id.
              const projectRef = isCf ? it.projectId : it.slug || it.projectId
              return (
                <div className={`crow ${it.enabled ? '' : 'off'}`} key={it.name}>
                  <div
                    className={`crow-lead ${projectRef ? 'clickable' : ''}`}
                    onClick={projectRef ? () => openDetail(projectRef, isCf ? 'curseforge' : 'modrinth') : undefined}
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
                      <span className={`crow-version ${version === t('unknown') ? 'unknown' : ''}`}>{version}</span>
                      {(update || isUpdating) && (
                        <button
                          className="crow-update"
                          data-tip={update ? t('updateTo') + ' ' + update : t('updatingEllipsis')}
                          disabled={isUpdating}
                          onClick={() => doUpdate(it.name)}
                        >
                          {isUpdating ? <Spinner /> : null}
                          {t('update')}
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
                    <Toggle
                      enabled={it.enabled}
                      tip={it.enabled ? t('enabledClickDisable') : t('disabledClickEnable')}
                      onToggle={async () => {
                        await window.beacon.toggleContent(profile.id, type, it.name, !it.enabled)
                        refreshItems()
                      }}
                    />
                    <button
                      className="crow-del"
                      data-tip={t('delete')}
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
                      data-tip={t('more')}
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
                          <button onClick={() => doUpdate(it.name)}>{t('updateTo')} {update}</button>
                        )}
                        <button
                          disabled={!url}
                          onClick={() => {
                            if (url) window.beacon.openUrl(url)
                            setRowMenu(null)
                          }}
                        >
                          {t('openModrinthPage')}
                        </button>
                        <button
                          onClick={() => {
                            window.beacon.openContentFolder(profile.id, type)
                            setRowMenu(null)
                          }}
                        >
                          {t('openFolder')}
                        </button>
                        <button
                          className="danger"
                          onClick={async () => {
                            setRowMenu(null)
                            await window.beacon.removeContent(profile.id, type, it.name)
                            refreshItems()
                          }}
                        >
                          {t('delete')}
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
            placeholder={t('searchWithModrinth') + ' ' + t(meta.labelKey).toLowerCase() + ' ' + t('withModrinth')}
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
        {/* CurseForge is disabled for now — with only Modrinth there's no source picker to show.
            Re-add a <Dropdown> here (options Modrinth / CurseForge) to bring it back. */}
        <Dropdown
          value={sort}
          onChange={(v) => {
            setSort(v)
            setPage(0)
            runSearch(query, v, type, 0)
          }}
          options={[
            { value: 'relevance', label: t('relevance') },
            { value: 'downloads', label: t('popularity') },
            { value: 'follows', label: t('following') },
            { value: 'newest', label: t('newest') },
            { value: 'updated', label: t('recentlyUpdated') },
          ]}
        />
      </div>
      <div className="cards">
        {loading && <LoadingBar />}
        {!loading && hits.length === 0 && <Empty />}
        {!loading &&
          hits.map((h) => (
            <div
              className="card clickable"
              key={h.id}
              onClick={() => openDetail(h.source === 'curseforge' ? h.id : h.slug || h.id, h.source ?? source)}
            >
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
              {renderInstallButton(h.id, () => install(h), h.source ?? source)}
            </div>
          ))}
      </div>
    </div>
  )
})
