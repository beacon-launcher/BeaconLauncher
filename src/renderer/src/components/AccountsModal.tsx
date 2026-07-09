import '../styles/AccountsModal.css'
import { useState } from 'react'
import type { Account } from '../types'
import { randomUsername } from '../helpers'
import { Modal } from './Modal'
import { ConfirmModal } from './ConfirmModal'
import { Spinner } from './ui'
import { t } from '../i18n'

export function AccountsModal({
  accounts,
  activeId,
  signingIn,
  onSelect,
  onAddMicrosoft,
  onAddOffline,
  onRemove,
  onClose
}: {
  accounts: Account[]
  activeId: string | null
  signingIn: boolean
  onSelect: (id: string) => void
  onAddMicrosoft: () => void
  onAddOffline: (name: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [newNick, setNewNick] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const addOffline = (): void => {
    const n = newNick.trim()
    if (!n) return
    onAddOffline(n)
    setNewNick('')
  }
  return (
    <>
    <Modal title={t('accounts')} onClose={onClose}>
      <div className="accounts">
        <div className="acc-add-section">
          <div className="acc-add-field">
            <input
              className="acc-add-input"
              value={newNick}
              maxLength={16}
              placeholder={t('newOfflineNickname')}
              onChange={(e) => setNewNick(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && addOffline()}
            />
            <button className="in-icon" data-tip={t('randomNickname')} onClick={() => setNewNick(randomUsername())}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="16" cy="8" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="8" cy="16" r="1.4" />
                <circle cx="16" cy="16" r="1.4" />
              </svg>
            </button>
          </div>
          <button className="add-btn" onClick={addOffline} disabled={!newNick.trim()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('addOfflineAccount')}
          </button>
          <button className="add-btn ms" onClick={onAddMicrosoft} disabled={signingIn}>
            {signingIn ? (
              <>
                <Spinner /> {t('waitingForMicrosoft')}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="3" y="3" width="8" height="8" fill="#f25022" />
                  <rect x="13" y="3" width="8" height="8" fill="#7fba00" />
                  <rect x="3" y="13" width="8" height="8" fill="#00a4ef" />
                  <rect x="13" y="13" width="8" height="8" fill="#ffb900" />
                </svg>
                {t('addMicrosoftAccount')}
              </>
            )}
          </button>
        </div>

        <div className="acc-list">
          {accounts.map((a) => {
            const licensed = a.type === 'msa'
            const active = activeId === a.id
            return (
              <div key={a.id} className={`acc-row ${active ? 'active' : ''}`}>
                <button className="acc-pick" onClick={() => onSelect(a.id)}>
                  <span className="acc-meta">
                    <span className="acc-name">{a.name}</span>
                    <span className="acc-sub">{licensed ? t('microsoft') : t('offline')}</span>
                  </span>
                </button>
                <div className="acc-actions">
                  <button className="plain-icon danger" data-tip={t('remove')} onClick={() => setConfirmRemove(a.id)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
    {confirmRemove && (
      <ConfirmModal
        title={t('removeAccountTitle')}
        message={t('confirmDeleteAccount')}
        confirmLabel={t('remove')}
        danger
        onConfirm={() => {
          onRemove(confirmRemove)
          setConfirmRemove(null)
        }}
        onClose={() => setConfirmRemove(null)}
      />
    )}
    </>
  )
}
