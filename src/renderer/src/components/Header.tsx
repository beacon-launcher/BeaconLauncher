import '../styles/Header.css'
import { t } from '../i18n'
import { Spinner } from './ui'

interface UpdateStatus {
  state: string
  version?: string
  percent?: number
  message?: string
  manual?: boolean
}

export function Header({
  navIdx,
  navLen,
  canBack,
  goBack,
  goForward,
  activeAccountName,
  username,
  showLog,
  setShowLog,
  runningProfile,
  update,
  maximized,
  onAccountsClick,
  onUpdateClick
}: {
  navIdx: number
  navLen: number
  canBack: boolean
  goBack: () => void
  goForward: () => void
  activeAccountName: string | null
  username: string | null
  showLog: boolean
  setShowLog: (v: (s: boolean) => boolean) => void
  runningProfile: { name: string } | null
  update: UpdateStatus | null
  maximized: boolean
  onAccountsClick: () => void
  onUpdateClick: () => void
}): React.JSX.Element {
  return (
    <header className="app-header">
      <div className="th-left">
        <button className="nav-btn" disabled={!canBack} onClick={goBack} aria-label={t('back')}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button className="nav-btn" disabled={navIdx >= navLen - 1} onClick={goForward} aria-label={t('forward')}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="th-center">
        <div className="nick-wrap">
          <button className="nick-bar" onClick={onAccountsClick} data-tip={t('accounts')}>
            <span className="nick-name">{activeAccountName ?? username ?? t('player')}</span>
            <svg className="nick-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {runningProfile && (
            <button className={`dice ${showLog ? 'on' : ''}`} data-tip={t('toggleConsole')} onClick={() => setShowLog((v) => !v)}>
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
              <Spinner /> {t('updating')} {update.percent ?? 0}%
            </span>
          ) : (
            <button className={`update-pill ${update.state === 'ready' ? 'ready' : ''}`} onClick={onUpdateClick}>
              {update.state === 'ready' ? (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
                  </svg>
                  {t('restartToUpdate')}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                  {t('updateAvailable')} {update.version ? `v${update.version}` : t('available')}
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="win-controls">
        <button className="win-btn" onClick={() => window.beacon.winMinimize()} aria-label={t('minimize')}>
          <svg viewBox="0 0 14 14" width="14" height="14">
            <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <button className="win-btn" onClick={() => window.beacon.winMaximize()} aria-label={maximized ? t('restore') : t('maximize')}>
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
        <button className="win-btn close" onClick={() => window.beacon.winClose()} aria-label={t('close')}>
          <svg viewBox="0 0 14 14" width="14" height="14">
            <line x1="3.2" y1="3.2" x2="10.8" y2="10.8" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10.8" y1="3.2" x2="3.2" y2="10.8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
    </header>
  )
}
