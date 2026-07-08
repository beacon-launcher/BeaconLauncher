import '../styles/Home.css'
import type { Profile } from '../types'
import { t } from '../i18n'
import { fmtPlaytime } from '../helpers'
import { ModpackBrowser } from './ModpackBrowser'

// The launcher's landing page (shown when no profile is selected): a compact hero with the total
// playtime, and a Modrinth modpack browser that creates a profile from a chosen pack.
export function HomeView({
  profiles,
  userName,
  onError,
  onCreated,
  onFooter,
  gotoRef,
  onDetailBack
}: {
  profiles: Profile[]
  userName: string
  onError: (m: string) => void
  onCreated: (p: { id: string }) => void
  onFooter: (info: { text: string; page: number; pages: number } | null) => void
  gotoRef: React.MutableRefObject<(p: number) => void>
  onDetailBack: (fn: (() => void) | null) => void
}): React.JSX.Element {
  const totalMs = profiles.reduce((a, p) => a + (p.playtimeMs ?? 0), 0)
  const totalLabel = fmtPlaytime(totalMs) ?? '0m'

  return (
    <div className="home">
      <div className="home-hero">
        <div className="hero-text">
          <div className="hero-title">{t('welcomeBack', { name: userName })}</div>
          <div className="hero-sub">
            {t('totalPlaytime')}: <b>{totalLabel}</b>
          </div>
        </div>
      </div>

      <section className="home-section home-modpacks">
        <div className="home-h">{t('browseModpacks')}</div>
        <ModpackBrowser onCreated={onCreated} onError={onError} onFooter={onFooter} gotoRef={gotoRef} onDetailBack={onDetailBack} />
      </section>
    </div>
  )
}
