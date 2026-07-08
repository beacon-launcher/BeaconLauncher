import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../types'
import { fmt, timeAgo } from '../helpers'
import { t } from '../i18n'
import { Spinner, LoadingBar, ContentIcon } from './ui'
import { Markdown } from './Markdown'

// Standalone Modrinth modpack page (opened from the Home modpack browser): the project's icon,
// description, stats, links and rendered body, plus an Install button that creates a profile from
// the pack. Reuses the shared .detail-* styles from Mods.css.
export function ModpackDetail({
  id,
  onCreated,
  onError
}: {
  id: string
  onCreated: (p: { id: string }) => void
  onError?: (m: string) => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let alive = true
    window.beacon.getProject(id).then((r) => {
      if (!alive) return
      if (r.ok && r.project) setDetail(r.project)
      else onError?.(r.error ?? t('failedToLoadProject'))
    })
    return () => {
      alive = false
    }
  }, [id])

  const install = async (): Promise<void> => {
    setInstalling(true)
    const r = await window.beacon.importModpackFromModrinth(id)
    setInstalling(false)
    if (r.ok && r.id) onCreated({ id: r.id })
    else onError?.(r.error ?? t('installFailed'))
  }

  const links = detail
    ? [
        { label: t('modrinth'), url: `https://modrinth.com/modpack/${detail.slug}` },
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
            <button className="install" onClick={install} disabled={installing}>
              {installing ? <Spinner /> : null}
              {installing ? t('installingEllipsis') : t('installModpack')}
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
          {detail.body && <Markdown body={detail.body} className="detail-body" />}
        </div>
      )}
    </div>
  )
}
