import { t } from '../i18n'

export function InstallsPanel({
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
        <span>{t('installingCount')} ({installs.length})</span>
        <button className="x" onClick={onClose} aria-label={t('close')}>
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
            <span className="install-detail">{it.text || t('installingEllipsis')}</span>
          </div>
          <button className="install-cancel" data-tip={t('cancelInstallTip')} onClick={() => onCancel(it.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
