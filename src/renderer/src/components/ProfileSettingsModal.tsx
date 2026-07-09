import '../styles/CreateProfileModal.css'
import { useEffect, useMemo, useState } from 'react'
import type { Profile } from '../types'
import { t } from '../i18n'
import { Spinner, MonoAvatar, RangeSlider, Toggle } from './ui'
import { Modal } from './Modal'
import { ConfirmModal } from './ConfirmModal'

export function ProfileSettingsModal({
  profile,
  onClose,
  onSaved,
  onDelete,
  onError
}: {
  profile: Profile
  onClose: () => void
  onSaved: () => void
  onDelete: () => void
  onError: (m: string) => void
}): React.JSX.Element {
  const [name, setName] = useState(profile.name)
  // undefined = keep current avatar, null = remove it, string = new local image path.
  const [avatarSrc, setAvatarSrc] = useState<string | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)

  const [allVersions, setAllVersions] = useState<{ id: string; type: string }[]>([])
  const [compat, setCompat] = useState<{ versions: string[] | null; unresolved: string[] } | null>(null)
  const [version, setVersion] = useState(profile.mcVersion)
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [repairing, setRepairing] = useState(false)

  // Per-profile RAM override.
  const [maxRam, setMaxRam] = useState(8192)
  const [globalMem, setGlobalMem] = useState(2048)
  const [memOverride, setMemOverride] = useState(profile.maxMemory != null)
  const [mem, setMem] = useState(profile.maxMemory ?? 2048)

  useEffect(() => {
    if (profile.avatar) window.beacon.imageDataUrl(profile.avatar).then(setPreview)
  }, [profile.avatar])

  useEffect(() => {
    window.beacon.totalRam().then((mb) => setMaxRam(Math.max(2048, Math.floor(mb / 512) * 512)))
    window.beacon.getSettings().then((s) => {
      setGlobalMem(s.maxMemory)
      if (profile.maxMemory == null) setMem(s.maxMemory)
    })
  }, [profile.id, profile.maxMemory])

  useEffect(() => {
    window.beacon.listVersions(true).then(setAllVersions)
    window.beacon.compatibleVersions(profile.id).then((r) => {
      setCompat(r.ok ? { versions: r.versions ?? null, unresolved: r.unresolved ?? [] } : { versions: null, unresolved: [] })
    })
  }, [profile.id])

  // Versions to offer: the mod-compatible intersection (plus the current one), unless "show all" is
  // on or there are no Modrinth mods to constrain (compat.versions === null → full list).
  const versionList = useMemo(() => {
    if (showAll || !compat || compat.versions === null) return allVersions
    const set = new Set([...compat.versions, profile.mcVersion])
    return allVersions.filter((v) => set.has(v.id))
  }, [showAll, compat, allVersions, profile.mcVersion])

  const constrained = !!compat && compat.versions !== null && !showAll
  const noCommon = constrained && (compat?.versions?.length ?? 0) === 0
  const versionChanged = version !== profile.mcVersion
  const memChanged = memOverride !== (profile.maxMemory != null) || (memOverride && mem !== profile.maxMemory)
  const changed = name.trim() !== profile.name || avatarSrc !== undefined || versionChanged || memChanged

  const pickAvatar = async (): Promise<void> => {
    const p = await window.beacon.pickImage()
    if (p) {
      setAvatarSrc(p)
      setPreview(await window.beacon.imageDataUrl(p))
    }
  }
  const removeAvatar = (): void => {
    setAvatarSrc(null)
    setPreview(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (name.trim() && name.trim() !== profile.name) await window.beacon.renameProfile(profile.id, name.trim())
      if (avatarSrc !== undefined) await window.beacon.setProfileAvatar(profile.id, avatarSrc)
      if (memChanged) await window.beacon.setProfileMemory(profile.id, memOverride ? mem : null)
      // A version change kicks off a background install (progress shows in the sidebar), so we don't
      // block the dialog on it — just start it and close.
      if (versionChanged) await window.beacon.setProfileVersion(profile.id, version)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const repair = async (): Promise<void> => {
    setRepairing(true)
    const r = await window.beacon.repairProfile(profile.id)
    setRepairing(false)
    if (!r.ok) onError(r.error ?? t('updateFailed'))
    else {
      onError(r.removed && r.removed.length ? t('repairDone', { count: r.removed.length }) : t('repairNothing'))
      onSaved()
    }
  }

  // Deletion is owned by the parent (it also navigates Home + refreshes, which unmounts this modal).
  const del = (): void => onDelete()

  return (
    <>
      <Modal
        title={t('profileSettings')}
        onClose={onClose}
        footer={
          <>
            <button className="side-btn danger-btn" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>
              {t('deleteProfile')}
            </button>
            <button className="side-btn" onClick={onClose}>
              {t('cancel')}
            </button>
            <button className="play" onClick={save} disabled={saving || !changed}>
              {saving ? (
                <>
                  <Spinner /> {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </button>
          </>
        }
      >
        <div className="avatar-picker">
          {preview ? <img className="avatar lg" src={preview} alt="" /> : <MonoAvatar size={62} />}
          <div className="ap-btns">
            <button className="ghost-btn" onClick={pickAvatar}>
              {t('selectIcon')}
            </button>
            <button className="ghost-btn subtle" disabled={!preview} onClick={removeAvatar}>
              {t('removeIcon')}
            </button>
          </div>
        </div>

        <label className="field">
          <span>{t('name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span>{t('memory')}</span>
          <div className="ps-mem-head">
            <span className="ps-mem-label">{t('overrideMemory')}</span>
            <Toggle enabled={memOverride} onToggle={() => setMemOverride((v) => !v)} />
          </div>
          {memOverride ? (
            <div className="mem-row">
              <RangeSlider min={1024} max={maxRam} step={128} value={Math.min(mem, maxRam)} onChange={setMem} />
              <div className="mem-input">
                <input
                  type="number"
                  min={1024}
                  max={maxRam}
                  step={512}
                  value={mem}
                  onChange={(e) => setMem(Number(e.target.value) || mem)}
                />
                <span className="mem-unit">{t('mb')}</span>
              </div>
            </div>
          ) : (
            <div className="ps-hint">{t('usingGlobalMemory', { mb: globalMem })}</div>
          )}
        </div>

        <div className="field">
          <span>{t('changeVersion')}</span>
          {!compat ? (
            <div className="ps-loading">
              <Spinner /> {t('loadingVersions')}
            </div>
          ) : (
            <>
              <VersionPicker
                versions={versionList}
                value={version}
                onChange={setVersion}
                showAll={showAll || compat.versions === null}
                canToggle={compat.versions !== null}
                onToggleShowAll={() => setShowAll((s) => !s)}
              />
              {constrained && !noCommon && <div className="ps-hint">{t('onlyCompatibleShown')}</div>}
              {noCommon && <div className="ps-warn">{t('noCommonVersion')}</div>}
              {compat.unresolved.length > 0 && (
                <div className="ps-warn">{t('modsCantMove', { mods: compat.unresolved.join(', ') })}</div>
              )}
              {versionChanged && <div className="ps-note">{t('changeVersionNote')}</div>}
            </>
          )}
        </div>

        <div className="field">
          <span>{t('repair')}</span>
          <div className="ps-mem-head">
            <span className="ps-hint">{t('repairDesc')}</span>
            <button className="ghost-btn" onClick={repair} disabled={repairing}>
              {repairing ? <Spinner /> : null}
              {t('repairProfile')}
            </button>
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmModal
          title={t('deleteProfile')}
          message={t('confirmDeleteProfile')}
          confirmLabel={t('deleteProfile')}
          danger
          onConfirm={del}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

// Searchable version dropdown. The compatible-only ↔ all-versions toggle lives at the bottom of the
// panel (same placement/style as the new-profile modal's `.vd-showall`). Reuses the .vd styles.
function VersionPicker({
  versions,
  value,
  onChange,
  showAll,
  canToggle,
  onToggleShowAll
}: {
  versions: { id: string; type: string }[]
  value: string
  onChange: (v: string) => void
  showAll: boolean
  canToggle: boolean
  onToggleShowAll: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const list = versions.filter((v) => v.id.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="vd" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="vd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{value || t('selectVersion')}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="vd-panel up">
          <input className="vd-search" placeholder={t('searchVersions')} autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="vd-list">
            {list.length === 0 && <div className="vd-empty">≧ ﹏ ≦</div>}
            {list.map((v) => (
              <button
                type="button"
                key={v.id}
                className={`vd-item ${v.id === value ? 'on' : ''}`}
                onClick={() => {
                  onChange(v.id)
                  setOpen(false)
                }}
              >
                <span>{v.id}</span>
              </button>
            ))}
          </div>
          {canToggle && (
            <button type="button" className="vd-showall" onClick={onToggleShowAll}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {showAll ? t('showCompatibleVersions') : t('showAllVersionsRisk')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
