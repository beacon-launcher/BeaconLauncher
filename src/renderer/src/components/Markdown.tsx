import '../styles/Markdown.css'
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Render a Modrinth project description (GitHub-flavoured markdown that may embed raw HTML like
// <center>/<img>/<small>) as sanitized HTML — the same way modrinth.com shows it, instead of the
// old plain-text strip that left tags and --- rules as literal characters.
export function Markdown({ body, className }: { body: string; className?: string }): React.JSX.Element {
  const html = useMemo(() => {
    const raw = marked.parse(body, { async: false, gfm: true, breaks: false }) as string
    return DOMPurify.sanitize(raw)
  }, [body])

  // Links inside the body must open in the user's browser, not navigate the app window.
  const onClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (a?.href) {
      e.preventDefault()
      window.beacon.openUrl(a.href)
    }
  }

  return <div className={`md-body ${className ?? ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
