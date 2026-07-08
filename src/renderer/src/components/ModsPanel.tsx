import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContentType, ContentItem, ModHit, ProjectDetail, Profile } from '../types'
import { tabsFor, PAGE, fmt, timeAgo, mdToText } from '../helpers'
import { Spinner, LoadingBar, Empty, ContentIcon, Toggle, Dropdown } from './ui'
import { t } from '../i18n'

export const ModsPanel = memo(function ModsPanel({
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
  const [filter, setFilter] = useState('')
  const [installedSort, setInstalledSort] = useState<'name' | 'author' | 'enabled'>('name')
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [updatingName, setUpdatingName] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
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

  const runSearch = async (q: string, s: string, ct: ContentType, p: number): Promise<void> => {
    setLoading(true)
    const r = await window.beacon.searchContent(q, profile.mcVersion, profile.loader, s, ct, p * PAGE)
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
    } else onError(r.error ?? t('installFailed'))
  }

  const openDetail = async (idOrSlug: string): Promise<void> => {
    setDetail(null)
    setDetailLoading(true)
    const r = await window.beacon.getProject(idOrSlug)
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
          <button className="ghost-btn accent" onClick={updateAll} disabled={updatingAll}>
            {updatingAll ? <Spinner /> : null}
            {updatingAll ? t('updatingEllipsis') : t('updateAll') + ' (' + Object.keys(updates).length + ')'}
          </button>
        )}
        <button className={`ghost-btn ${view === 'browse' ? 'on' : ''}`} onClick={() => (view === 'browse' ? setView('content') : openBrowse())}>
          {t('browse')}
        </button>
        <button className="ghost-btn" onClick={() => window.beacon.openContentFolder(profile.id, type)}>
          {t('addManually')}
        </button>
      </div>
    </div>
  )

  if (inDetail) {
    const installed = detail ? installedIds.has(detail.id) : false
    const busy = detail ? busyId === detail.id : false
    const links: { label: string; url?: string }[] = detail
      ? [
          { label: t('modrinth'), url: `https://modrinth.com/project/${detail.slug}` },
          { label: t('source'), url: detail.source },
          { label: t('issues'), url: detail.issues },
          { label: t('wiki'), url: detail.wiki },
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
                {detail.author && <span className="detail-author">{t('by')} {detail.author}</span>}
                <p className="detail-desc">{detail.description}</p>
                <div className="detail-stats">
                  <span>↓ {fmt(detail.downloads)}</span>
                  <span>♥ {fmt(detail.follows)}</span>
                  {detail.updated && <span>{timeAgo(detail.updated)}</span>}
                </div>
              </div>
              <button className={`install ${installed ? 'done' : ''}`} onClick={() => installById(detail)} disabled={busy || installed}>
                {busy ? <Spinner /> : null}
                {installed ? t('installed') : busy ? t('installingEllipsis') : t('install')}
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
          {dropping && <div className="drop-hint">{t('dropFilesHint')}</div>}
          {items.length === 0 ? (
            <Empty hint={`${t('noContentPrefix')} ${t(meta.singularKey).toLowerCase()} ${t('noContentSuffix')}`} />
          ) : filtered.length === 0 ? (
            <Empty />
          ) : (
            filtered.map((it) => {
              const title = it.title || it.name
              const version = it.version || t('unknown')
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
                      <span className={`crow-version ${version === t('unknown') ? 'unknown' : ''}`}>{version}</span>
                      {(update || isUpdating) && (
                        <button
                          className="crow-update"
                          data-tip={update ? t('updateTo') + ' ' + update : t('updatingEllipsis')}
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
                  {done ? t('installed') : inProgress ? t('installingEllipsis') : t('install')}
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
})
