import '../styles/ColorPicker.css'
import { useEffect, useRef, useState } from 'react'
import { hexToHsv, hsvToHex } from '../helpers'

export function ColorPicker({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }): React.JSX.Element {
  const parsed = hexToHsv(value)
  const [hue, setHue] = useState(parsed.h)
  const { s, v } = parsed
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const dragOn = (ref: React.RefObject<HTMLDivElement | null>, handler: (nx: number, ny: number) => void) => (e: React.PointerEvent): void => {
    const apply = (cx: number, cy: number): void => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      handler(Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height)))
    }
    apply(e.clientX, e.clientY)
    const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onSV = dragOn(svRef, (nx, ny) => onChange(hsvToHex(hue, nx, 1 - ny)))
  const onHue = dragOn(hueRef, (nx) => {
    const nh = nx * 360
    setHue(nh)
    onChange(hsvToHex(nh, s || 1, v || 1))
  })

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.cpick') && !(e.target as HTMLElement).closest('.accent-card.custom')) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])

  return (
    <div className="cpick" onClick={(e) => e.stopPropagation()}>
      <div
        className="cpick-sv"
        ref={svRef}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hue, 1, 1)})` }}
        onPointerDown={onSV}
      >
        <span className="cpick-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div className="cpick-hue" ref={hueRef} onPointerDown={onHue}>
        <span className="cpick-dot hue" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <div className="cpick-foot">
        <span className="cpick-preview" style={{ background: value }} />
        <input
          className="cpick-hex"
          value={text}
          onChange={(e) => {
            let t = e.target.value
            if (!t.startsWith('#')) t = `#${t}`
            setText(t)
            if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase())
          }}
        />
      </div>
    </div>
  )
}
