import '../styles/SettingsModal.css'
import { useState } from 'react'
import type { Settings } from '../types'
import { JAVA_KEYS, ACCENTS } from '../helpers'
import { t, availableLanguages, setLanguage } from '../i18n'
import { Spinner, Toggle, RangeSlider } from './ui'
import { Modal } from './Modal'
import { ColorPicker } from './ColorPicker'

interface UpdateStatus {
  state: string
  version?: string
  percent?: number
  message?: string
  manual?: boolean
}

export function SettingsModal({
  settings,
  maxRam,
  appVersion,
  update,
  onCheckUpdate,
  onUpdate,
  onChange,
  onClose
}: {
  settings: Settings
  maxRam: number
  appVersion: string
  update: UpdateStatus | null
  onCheckUpdate: () => void
  onUpdate: () => void
  onChange: (s: Settings) => void
  onClose: () => void
}): React.JSX.Element {
  const patch = (p: Partial<Settings>): void => onChange({ ...settings, ...p })
  const mem = Math.min(settings.maxMemory, maxRam)
  const theme = settings.theme ?? 'system'
  const [pickerOpen, setPickerOpen] = useState(false)
  const presetOn = (c: string): boolean => ACCENTS.some((a) => a.color.toLowerCase() === c.toLowerCase())
  const [isCustom, setIsCustomState] = useState(() => localStorage.getItem('beacon.accentCustom') === '1' || !presetOn(settings.accentColor))
  const setCustom = (on: boolean): void => {
    setIsCustomState(on)
    localStorage.setItem('beacon.accentCustom', on ? '1' : '0')
  }
  const pickPreset = (color: string): void => {
    setCustom(false)
    patch({ accentColor: color })
  }
  const [memText, setMemText] = useState<string | null>(null)
  return (
    <Modal title={t('settings')} onClose={onClose} wide>
      <div className="settings">
        <div className="set-row">
          <div className="set-head">
            <span className="set-title">{t('theme')}</span>
            <span className="set-sub">{t('themeDesc')}</span>
          </div>
          <div className="theme-grid">
            {(['system', 'dark', 'light'] as const).map((th) => (
              <button key={th} className={`theme-card ${theme === th ? 'on' : ''}`} onClick={() => patch({ theme: th })}>
                <div className={`tc-preview ${th}`}>
                  <span className="tc-side" />
                  <span className="tc-main">
                    <i />
                    <i />
                    <i />
                  </span>
                  {theme === th && (
                    <span className="tc-check">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                  )}
                </div>
                <span className="ac-label">{th === 'system' ? t('system') : th === 'dark' ? t('dark') : t('light')}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">{t('accentColour')}</span>
            <span className="set-sub">{t('accentDesc')}</span>
          </div>
          <div className="accent-grid">
            {ACCENTS.map((a) => {
              const on = !isCustom && settings.accentColor.toLowerCase() === a.color.toLowerCase()
              return (
                <button
                  key={a.color}
                  className={`accent-card ${on ? 'on' : ''}`}
                  style={{ ['--c' as string]: a.color }}
                  onClick={() => pickPreset(a.color)}
                >
                  <div className="ac-preview">
                    <div className="ac-dots">
                      <span />
                      <span />
                    </div>
                    <div className="ac-lines">
                      <span />
                      <span className="hi" />
                      <span />
                    </div>
                    {on && (
                      <span className="ac-check">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                    )}
                    <span className="ac-bar" />
                  </div>
                  <span className="ac-label">{t(a.labelKey)}</span>
                </button>
              )
            })}
            <div className="accent-custom-wrap">
              <button
                className={`accent-card custom ${isCustom ? 'on' : ''}`}
                style={{ ['--c' as string]: settings.accentColor }}
                onClick={() => {
                  setCustom(true)
                  setPickerOpen((o) => !o)
                }}
              >
                <div className="ac-preview">
                  <span className="ac-plus">+</span>
                  {isCustom && (
                    <span className="ac-check">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                  )}
                  <span className="ac-bar" style={{ background: settings.accentColor }} />
                </div>
                <span className="ac-label">{t('custom')}</span>
              </button>
              {pickerOpen && (
                <ColorPicker
                  value={settings.accentColor}
                  onChange={(c) => {
                    setCustom(true)
                    patch({ accentColor: c })
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">{t('language')}</span>
            <span className="set-sub">{t('languageDesc')}</span>
          </div>
          <div className="loaders">
            {availableLanguages.map((lang) => (
              <button
                key={lang.code}
                className={`loader-btn ${(settings.language || 'en') === lang.code ? 'on' : ''}`}
                onClick={() => {
                  // Switch i18next synchronously so the very first click re-renders in the new
                  // language (t() isn't reactive on its own — the settings update drives the render).
                  setLanguage(lang.code)
                  patch({ language: lang.code })
                }}
              >
                {lang.nativeName}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row inline">
          <div className="set-head">
            <span className="set-title">{t('discordRichPresence')}</span>
            <span className="set-sub">{t('discordDesc')}</span>
          </div>
          <Toggle
            enabled={settings.discordRpc}
            onToggle={() => patch({ discordRpc: !settings.discordRpc })}
            tip={settings.discordRpc ? t('on') : t('off')}
          />
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">{t('memory')}</span>
            <span className="set-sub">{maxRam} {t('memoryDesc')}</span>
          </div>
          <div className="mem-row">
            <RangeSlider
              min={1024}
              max={maxRam}
              step={128}
              value={mem}
              onChange={(v) => patch({ maxMemory: v })}
            />
            <div className="mem-input">
              <input
                type="number"
                min={1024}
                max={maxRam}
                step={512}
                value={memText ?? mem}
                onChange={(e) => {
                  const raw = e.target.value
                  setMemText(raw)
                  const v = Number(raw)
                  if (raw !== '' && !Number.isNaN(v)) patch({ maxMemory: v })
                }}
                onBlur={() => {
                  const v = memText === '' || memText === null || Number.isNaN(Number(memText)) ? mem : Number(memText)
                  patch({ maxMemory: Math.max(1024, Math.min(maxRam, Math.round(v / 512) * 512)) })
                  setMemText(null)
                }}
              />
              <span className="mem-unit">{t('mb')}</span>
            </div>
          </div>
        </div>

        <div className="set-row">
          <div className="set-head">
            <span className="set-title">{t('java')}</span>
            <span className="set-sub">{t('javaDesc')}</span>
          </div>
          <div className="jslots">
            {[25, 21, 17, 8].map((major) => (
              <JavaSlot key={major} major={major} value={settings[JAVA_KEYS[major]] as string} onChange={(v) => patch({ [JAVA_KEYS[major]]: v } as Partial<Settings>)} />
            ))}
          </div>
        </div>

        <div className="set-row inline">
          <div className="set-head">
            <span className="set-title">{t('about')}</span>
            <span className="set-sub">
              Beacon Launcher {appVersion ? `v${appVersion}` : ''}
              {update?.state === 'checking' && ` — ${t('checking')}`}
              {update?.state === 'available' && ` — v${update.version} ${t('available')}`}
              {update?.state === 'downloading' && ` — ${t('installing')} ${update.percent ?? 0}%`}
              {update?.state === 'ready' && ` — v${update.version} ${t('readyToInstall')}`}
              {update?.state === 'none' && ` — ${t('upToDate')}`}
            </span>
          </div>
          {update?.state === 'ready' ? (
            <button className="ghost-btn accent" onClick={onUpdate}>
              {t('restartToUpdate')}
            </button>
          ) : update?.state === 'available' ? (
            <button className="ghost-btn accent" onClick={onUpdate}>
              {t('downloadUpdate')}
            </button>
          ) : (
            <button className="ghost-btn" onClick={onCheckUpdate} disabled={update?.state === 'checking' || update?.state === 'downloading'}>
              {update?.state === 'checking' ? <Spinner /> : null}
              {t('checkForUpdates')}
            </button>
          )}
        </div>

        <div className="set-row inline">
          <div className="set-head">
            <span className="set-title">{t('logs')}</span>
            <span className="set-sub">{t('logsSub')}</span>
          </div>
          <button className="ghost-btn" onClick={() => window.beacon.openLogs()}>
            {t('openLogsFolder')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function JavaSlot({ major, value, onChange }: { major: number; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<'install' | 'detect' | ''>('')

  const detect = async (): Promise<void> => {
    setBusy('detect')
    const r = await window.beacon.detectJava(major)
    setBusy('')
    if (r.ok && r.path) onChange(r.path)
  }
  const install = async (): Promise<void> => {
    setBusy('install')
    const r = await window.beacon.installJava(major)
    setBusy('')
    if (r.ok && r.path) onChange(r.path)
  }
  const browse = async (): Promise<void> => {
    const j = await window.beacon.pickJava()
    if (j) onChange(j)
  }

  return (
    <div className="jslot">
      <div className="jslot-title">{t('javaLocation')} {major} {t('javaLocationSuffix')}</div>
      <div className="jslot-input">
        <input placeholder={t('pathToJava')} value={value} onChange={(e) => onChange(e.target.value)} />
        <span className={`jcheck ${value ? 'ok' : 'bad'}`} title={value ? t('javaSet') : t('javaNotSet')}>
          {value ? '✓' : '✕'}
        </span>
      </div>
      <div className="jslot-btns">
        <button onClick={install} disabled={!!busy || !!value} data-tip={value ? t('javaAlreadySet') : undefined}>
          {busy === 'install' ? <Spinner /> : null}
          {t('installRecommended')}
        </button>
        <button onClick={detect} disabled={!!busy}>
          {busy === 'detect' ? <Spinner /> : null}
          {t('detect')}
        </button>
        <button onClick={browse} disabled={!!busy}>
          {t('browseButton')}
        </button>
        {value && (
          <button className="jclear" onClick={() => onChange('')} disabled={!!busy}>
            {t('clear')}
          </button>
        )}
      </div>
    </div>
  )
}
