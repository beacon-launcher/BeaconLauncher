import { t } from '../i18n'
import { Modal } from './Modal'
import type { ModConflictReport } from '../types'

// Shown when a launch is blocked by a mod incompatibility — either caught before launch (static
// fabric.mod.json check) or parsed out of a Fabric crash. Lists each conflicting pair and lets the
// user disable one of the involved mods with a single click (then we re-launch). A pre-launch block
// also offers "launch anyway" as an escape hatch in case the static check was over-eager.
export function ModConflictModal({
  report,
  onDisable,
  onLaunchAnyway,
  onClose
}: {
  report: ModConflictReport
  onDisable: (filename: string) => void
  onLaunchAnyway: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={t('modConflictTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="side-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          {report.source === 'prelaunch' && (
            <button className="side-btn" onClick={onLaunchAnyway}>
              {t('launchAnyway')}
            </button>
          )}
        </>
      }
    >
      <p className="confirm-msg">{t('modConflictIntro')}</p>
      <div className="conflict-list">
        {report.conflicts.map((c, i) => (
          <div className="conflict-item" key={i}>
            <div className="conflict-msg">{c.message}</div>
            <div className="conflict-actions">
              {c.mods
                .filter((m) => m.filename)
                .map((m) => (
                  <button key={m.filename} className="play stop" onClick={() => onDisable(m.filename!)}>
                    {t('disableMod', { name: m.name })}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
