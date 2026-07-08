import '../styles/ProfileView.css'
import { useState } from 'react'
import type { Profile } from '../types'
import { t, getLanguage } from '../i18n'
import { fmtPlaytime } from '../helpers'
import { ModsPanel } from './ModsPanel'

export function ProfileView({
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
  gotoRef,
  onDetailBack
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
  onDetailBack: (fn: (() => void) | null) => void
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
              <button className="tb-edit" data-tip={t('renameProfile')} onClick={startEdit}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </h1>
          )}
          <span className="meta">
            {profile.loader} {profile.mcVersion}
            {played && <span className="playtime">{played} {t('played')}</span>}
          </span>
        </div>
        <div className="tb-actions">
          <button className="icon-btn" onClick={() => window.beacon.openProfileFolder(profile.id)}>
{t('folder')}
          </button>
          {status === 'installing' ? (
            <button className="play installing" onClick={onCancel} data-tip={t('cancelInstall')}>
              {t('installing')} {pct}% <span className="btn-x">✕</span>
            </button>
          ) : status === 'launching' ? (
            <button className="play" disabled>
              {t('launching')}
            </button>
          ) : status === 'running' ? (
            <button className="play stop" onClick={onStop}>
{t('stop')}
            </button>
          ) : (
            <button className="play" onClick={onPlay} disabled={blocked} data-tip={blocked ? t('stopRunningFirst') : undefined}>
{t('play')}
            </button>
          )}
        </div>
      </header>

      <div className="body">
        <ModsPanel profile={profile} onError={onError} onFooter={onFooter} gotoRef={gotoRef} onDetailBack={onDetailBack} lang={getLanguage()} />
      </div>
    </div>
  )
}
