import { t } from '../i18n'
import { Modal } from './Modal'

// Small reusable confirmation dialog. `danger` styles the confirm button as destructive.
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="side-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className={danger ? 'play stop' : 'play'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-msg">{message}</p>
    </Modal>
  )
}
