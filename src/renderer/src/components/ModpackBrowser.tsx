import '../styles/ModpackBrowser.css'
import { useEffect, useState } from 'react'
import type { ModHit } from '../types'
import { fmt } from '../helpers'
import { t } from '../i18n'
import { Spinner, ContentIcon } from './ui'
import { ModpackDetail } from './ModpackDetail'

// Browse Modrinth modpacks and create a profile from one (downloads its .mrpack and imports it
// through the same path as a local .mrpack). Used on the Home page.
export function ModpackBrowser({
  onCreated,
  onError,
  onFooter,
  gotoRef,
  onDetailBack
}: {
  onCreated: (p: { id: string }) => void
  onError?: (m: string) => void
  onFooter?: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef?: React.MutableRefObject<(p: number) => void>
  onDetailBack?: (fn: (() => void) | null) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const PER = 20
  const pages = Math.max(1, Math.ceil(total / PER))

  useEffect(() => {
    let alive = true
    setLoading(true)
    const id = setTimeout(() => {
      window.beacon.searchModpacks(query, 'relevance', page * PER).then((r) => {
        if (!alive) return
        setLoading(false)
        if (r.ok) {
          setHits(r.hits ?? [])
          setTotal(r.total ?? 0)
        } else onError?.(r.error ?? t('searchFailed'))
      })
    }, 350)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, page])

  // Pagination lives in the app's persistent bottom footer (same as the mods browser). Only report
  // it in the list view; the detail page clears it.
  if (gotoRef) gotoRef.current = (p: number): void => setPage(Math.max(0, Math.min(pages - 1, p)))
  useEffect(() => {
    if (detailId) onFooter?.(null)
    else onFooter?.({ text: `${total.toLocaleString()} ${total === 1 ? t('result') : t('results')}`, page, pages })
  }, [detailId, total, page, pages, onFooter])
  useEffect(() => () => onFooter?.(null), [onFooter])

  // Let the top-bar Back arrow close an open modpack page (no in-page Back button).
  useEffect(() => {
    onDetailBack?.(detailId ? () => setDetailId(null) : null)
    return () => onDetailBack?.(null)
  }, [detailId, onDetailBack])

  const pick = async (id: string): Promise<void> => {
    if (importingId) return
    setImportingId(id)
    const r = await window.beacon.importModpackFromModrinth(id)
    setImportingId(null)
    if (r.ok && r.id) onCreated({ id: r.id })
    else onError?.(r.error ?? t('installFailed'))
  }

  if (detailId) {
    return <ModpackDetail id={detailId} onCreated={onCreated} onError={onError} />
  }

  return (
    <div className="mp-browse">
      <input
        className="mp-search"
        placeholder={t('searchModpacksPlaceholder')}
        value={query}
        onChange={(e) => {
          setPage(0)
          setQuery(e.target.value)
        }}
      />
      {loading ? (
        <div className="mp-status">
          <Spinner /> {t('searching')}
        </div>
      ) : hits.length === 0 ? (
        <div className="mp-status">{t('noModpacksFound')}</div>
      ) : (
        <div className="mp-list">
          {hits.map((h) => (
            <div key={h.id} className="mp-row" role="button" tabIndex={0} onClick={() => setDetailId(h.id)}>
              {h.iconUrl ? <img className="mp-icon" src={h.iconUrl} alt="" /> : <ContentIcon />}
              <div className="mp-main">
                <div className="mp-title">{h.title}</div>
                <div className="mp-desc">{h.description}</div>
                <div className="mp-meta">
                  {h.author}
                  <span className="mp-dl">
                    ↓ {fmt(h.downloads)} {t('downloads')}
                  </span>
                </div>
              </div>
              <button
                className="install mp-install"
                disabled={!!importingId}
                onClick={(e) => {
                  e.stopPropagation()
                  pick(h.id)
                }}
              >
                {importingId === h.id ? <Spinner /> : null}
                {t('installModpack')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
