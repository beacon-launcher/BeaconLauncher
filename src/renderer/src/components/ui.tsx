import { useCallback, useEffect, useRef, useState } from 'react'
import type { Profile } from '../types'

export function Spinner(): React.JSX.Element {
  return <span className="spinner" aria-hidden="true" />
}

export function LoadingBar(): React.JSX.Element {
  return <div className="loading-bar" role="progressbar" aria-label="Loading" />
}

export function Empty({ hint }: { hint?: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="kao">≧ ﹏ ≦</span>
      {hint && <span className="empty-hint">{hint}</span>}
    </div>
  )
}

export function MonoAvatar({ size }: { size: number }): React.JSX.Element {
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="var(--input)" />
      <circle cx="38" cy="40" r="9" fill="var(--dim)" />
      <path d="M18 78 L44 50 L58 64 L72 52 L86 78 Z" fill="var(--dim)" />
    </svg>
  )
}

export function Avatar({ profile, size }: { profile: Profile; size: number }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (profile.avatar) window.beacon.imageDataUrl(profile.avatar).then((u) => alive && setUrl(u))
    else setUrl(null)
    return () => {
      alive = false
    }
  }, [profile.avatar])
  if (url) return <img className="avatar" src={url} width={size} height={size} alt="" />
  return <MonoAvatar size={size} />
}

export function ContentIcon({ url }: { url?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  if (url && !broken) return <img className="crow-icon" src={url} alt="" onError={() => setBroken(true)} />
  return (
    <span className="crow-icon ph">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.3 7L12 12l8.7-5M12 22V12" />
      </svg>
    </span>
  )
}

export function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z" />
    </svg>
  )
}

export function Toggle({
  enabled,
  onToggle,
  tip,
  disabled
}: {
  enabled: boolean
  onToggle: () => void
  tip?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      className={`toggle ${enabled ? 'on' : ''}`}
      data-tip={tip}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="knob" />
    </button>
  )
}

export function RangeSlider({
  min,
  max,
  value,
  step,
  onChange
}: {
  min: number
  max: number
  value: number
  step?: number
  onChange: (v: number) => void
}): React.JSX.Element {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className="filled"
      min={min}
      max={max}
      step={step ?? 1}
      value={value}
      style={{ ['--fill' as string]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function Dropdown({
  value,
  onChange,
  options,
  tip
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  tip?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return (
    <div className={`dd ${open ? 'open' : ''}`} ref={ref}>
      <button className="dd-trigger" data-tip={tip} onClick={() => setOpen((o) => !o)}>
        <span className="dd-label">{current?.label ?? value}</span>
        <span className="dd-arrow" />
      </button>
      {open && (
        <div className="dd-menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`dd-opt ${o.value === value ? 'on' : ''}`}
              onClick={() => {
                onChange(o.value)
                close()
              }}
            >
              {o.label}
              {o.value === value && <span className="dd-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
