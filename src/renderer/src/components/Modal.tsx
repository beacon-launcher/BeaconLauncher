import '../styles/Modal.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Tooltip(): React.JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean; wrap: boolean } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const elRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!tip || !tipRef.current || pos) return
    const r = elRef.current?.getBoundingClientRect()
    if (!r) return
    const tr = tipRef.current.getBoundingClientRect()
    const tipH = tr.height
    const spaceAbove = r.top
    const spaceBelow = window.innerHeight - r.bottom
    let below = tip.below
    if (below && spaceBelow < tipH + 8 && spaceAbove >= tipH + 8) {
      below = false
    } else if (!below && spaceAbove < tipH + 8 && spaceBelow >= tipH + 8) {
      below = true
    }
    const half = tr.width / 2
    let x = r.left + r.width / 2
    // Keep the (centre-anchored) tooltip inside the viewport horizontally. If it's wider than the
    // window, just centre it rather than letting the clamp invert.
    x = tr.width >= window.innerWidth - 16 ? window.innerWidth / 2 : Math.max(half + 8, Math.min(x, window.innerWidth - half - 8))
    const y = below ? r.bottom : r.top
    setPos({ x: Math.round(x), y: Math.round(y), below })
  })

  useEffect(() => {
    const target = (e: Event): HTMLElement | null =>
      (e.target instanceof Element ? e.target.closest('[data-tip]') : null) as HTMLElement | null
    const hide = (): void => {
      elRef.current = null
      tipRef.current = null
      setTip(null)
      setPos(null)
    }
    const show = (el: HTMLElement): void => {
      // Already showing for this element — don't re-measure (moving over child nodes fires
      // mouseover repeatedly; re-triggering would make the tooltip flicker/jump).
      if (el === elRef.current) return
      const text = el.getAttribute('data-tip')
      if (!text) return
      const r = el.getBoundingClientRect()
      const wrap = r.width < 250
      elRef.current = el
      let x = r.left + r.width / 2
      x = Math.max(0, Math.min(x, window.innerWidth))
      const preferBelow = r.top > window.innerHeight / 2
      const y = preferBelow ? r.bottom : r.top
      setTip({ text, x: Math.round(x), y: Math.round(y), below: preferBelow, wrap })
      setPos(null)
    }
    const onOver = (e: MouseEvent): void => {
      const el = target(e)
      if (el) show(el)
    }
    const onOut = (e: MouseEvent): void => {
      // Only hide when the pointer actually LEAVES the tooltipped element — not when it moves
      // between child nodes inside it (mouseout fires for those too, with relatedTarget still
      // inside the element).
      const el = elRef.current
      if (!el) return
      const to = e.relatedTarget as Node | null
      if (!to || !el.contains(to)) hide()
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('scroll', hide, true)
    const iv = setInterval(() => {
      if (elRef.current && !elRef.current.isConnected) hide()
    }, 200)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('scroll', hide, true)
      clearInterval(iv)
    }
  }, [])
  if (!tip) return null
  const below = pos ? pos.below : tip.below
  return (
    <div
      ref={tipRef}
      className={`tooltip ${below ? 'below' : ''} ${tip.wrap ? 'tip-wrap' : ''} ${pos ? 'shown' : ''}`}
      // First render (pos not yet computed) is measured off-screen-invisible so the user never sees
      // it flash at the rough position before it snaps to the adapted one.
      style={{ left: pos?.x ?? tip.x, top: pos?.y ?? tip.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      {tip.text}
    </div>
  )
}
