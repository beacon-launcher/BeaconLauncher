import { useLayoutEffect, useRef } from 'react'
import { cleanConsole, CONSOLE_ART_KEY } from '../helpers'
import { t } from '../i18n'

// The game-log overlay. Sticks to the bottom (latest output) as lines arrive, but if the user
// scrolls up to read history it stops auto-scrolling until they return to the bottom.
export function ConsolePage({ log }: { log: string }): React.JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  const text = cleanConsole(log) || t(CONSOLE_ART_KEY)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="console-page">
      <pre
        className="console-body"
        ref={ref}
        onScroll={() => {
          const el = ref.current
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {text}
      </pre>
    </div>
  )
}
