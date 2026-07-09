import '../styles/ProfileView.css'
import { useState } from 'react'
import type { Profile } from '../types'
import { t, getLanguage } from '../i18n'
import { fmtPlaytime } from '../helpers'
import { ModsPanel } from './ModsPanel'
import { ProfileSettingsModal } from './ProfileSettingsModal'

export function ProfileView({
  profile,
  state,
  blocked,
  liveMs,
  onPlay,
  onStop,
  onCancel,
  onError,
  onDelete,
  onRefresh,
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
  onDelete: () => void
  onRefresh: () => void
  onFooter: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef: React.MutableRefObject<(p: number) => void>
  onDetailBack: (fn: (() => void) | null) => void
}): React.JSX.Element {
  const status = state?.status
  const pct = state?.percent ?? 0
  const played = fmtPlaytime((profile.playtimeMs ?? 0) + liveMs)
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div className="view">
      <header className="topbar">
        <div className="tb-title">
          <h1 className="tb-name">{profile.name}</h1>
          <span className="meta">
            {profile.loader} {profile.mcVersion}
            {played && <span className="playtime">{played} {t('played')}</span>}
          </span>
        </div>
        <div className="tb-actions">
          <button className="icon-btn" data-tip={t('profileSettings')} onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button className="icon-btn" data-tip={t('folder')} onClick={() => window.beacon.openProfileFolder(profile.id)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
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

      {showSettings && (
        <ProfileSettingsModal
          profile={profile}
          onClose={() => setShowSettings(false)}
          onSaved={onRefresh}
          onDelete={onDelete}
          onError={onError}
        />
      )}
    </div>
  )
}
