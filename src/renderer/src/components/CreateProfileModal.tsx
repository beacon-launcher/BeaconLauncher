import { useEffect, useMemo, useState } from 'react'
import type { Loader, Profile } from '../types'
import { LOADERS } from '../helpers'
import { t } from '../i18n'
import { Spinner, MonoAvatar } from './ui'
import { Modal } from './Modal'

export function CreateProfileModal({
  defaultName,
  onClose,
  onCreated
}: {
  defaultName: string
  onClose: () => void
  onCreated: (p: Profile) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [versions, setVersions] = useState<{ id: string; type: string }[]>([])
  const [version, setVersion] = useState('')
  const [loader, setLoader] = useState<Loader>('fabric')
  const [supported, setSupported] = useState<Set<string> | null>(null)
  const [loaderMode, setLoaderMode] = useState<'stable' | 'latest'>('stable')
  const [builds, setBuilds] = useState<{ version: string; stable: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  useEffect(() => {
    window.beacon.listVersions(true).then((vs) => {
      setVersions(vs)
      setVersion((cur) => cur || vs.find((v) => v.type === 'release')?.id || vs[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    let alive = true
    window.beacon.loaderVersions(loader).then((list) => {
      if (alive) setSupported(list ? new Set(list) : null)
    })
    return () => { alive = false }
  }, [loader])

  const available = useMemo(
    () => (supported ? versions.filter((v) => supported.has(v.id)) : versions),
    [versions, supported]
  )

  useEffect(() => {
    if (!supported || !versions.length) return
    if (version && supported.has(version)) return
    const next = available.find((v) => v.type === 'release')?.id ?? available[0]?.id ?? ''
    if (next) setVersion(next)
  }, [supported, versions, available, version])

  useEffect(() => {
    if (loader === 'vanilla' || !version) {
      setBuilds([])
      return
    }
    let alive = true
    window.beacon.loaderBuilds(loader, version).then((b) => {
      if (alive) setBuilds(b)
    })
    return () => { alive = false }
  }, [loader, version])

  const create = async (): Promise<void> => {
    if (!version) return
    const loaderVersion = loader === 'vanilla' || loaderMode === 'stable' ? undefined : builds[0]?.version
    setSaving(true)
    const p = await window.beacon.addProfile(name, version, loader, loaderVersion, avatarSrc ?? undefined)
    setSaving(false)
    onCreated(p)
  }

  return (
    <Modal
      title={t('newProfileTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="side-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="play" onClick={create} disabled={saving || !version}>
            {saving ? (
              <>
                <Spinner /> {t('creating')}
              </>
            ) : (
              t('create')
            )}
          </button>
        </>
      }
    >
      <div className="avatar-picker">
        {avatarPreview ? <img className="avatar lg" src={avatarPreview} alt="" /> : <MonoAvatar size={62} />}
        <div className="ap-btns">
          <button
            className="ghost-btn"
            onClick={async () => {
              const p = await window.beacon.pickImage()
              if (p) {
                setAvatarSrc(p)
                setAvatarPreview(await window.beacon.imageDataUrl(p))
              }
            }}
          >
            {t('selectIcon')}
          </button>
          <button
            className="ghost-btn subtle"
            disabled={!avatarSrc}
            onClick={() => {
              setAvatarSrc(null)
              setAvatarPreview(null)
            }}
          >
            {t('removeIcon')}
          </button>
        </div>
      </div>

      <label className="field">
        <span>{t('name')}</span>
        <input placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>{t('loader')}</span>
        <div className="loaders">
          {LOADERS.map((l) => (
            <button key={l.key} className={`loader-btn ${loader === l.key ? 'on' : ''}`} onClick={() => setLoader(l.key)}>
              {t(l.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('gameVersion')}</span>
        <VersionDropdown versions={available} value={version} onChange={setVersion} />
      </div>
      {loader !== 'vanilla' && (
        <div className="field">
          <span>{t('loaderVersion')}</span>
          <div className="loaders">
            {(['stable', 'latest'] as const).map((m) => (
              <button key={m} className={`loader-btn ${loaderMode === m ? 'on' : ''}`} onClick={() => setLoaderMode(m)}>
                {m === 'stable' ? t('stable') : t('latest')}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function VersionDropdown({ versions, value, onChange }: { versions: { id: string; type: string }[]; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const list = versions.filter((v) => (showAll || v.type === 'release') && v.id.toLowerCase().includes(q.toLowerCase()))

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
          <button type="button" className="vd-showall" onClick={() => setShowAll((s) => !s)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {showAll ? t('showReleaseVersions') : t('showAllVersions')}
          </button>
        </div>
      )}
    </div>
  )
}
