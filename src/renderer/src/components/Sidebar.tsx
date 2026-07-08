import { useState } from 'react'
import type { Profile } from '../types'
import { t } from '../i18n'
import { Avatar, GearIcon } from './ui'

export function Sidebar({
  profiles,
  selectedId,
  pstates,
  sidebarWidth,
  onResize,
  onSelect,
  onContextMenu,
  dragId,
  setDragId,
  drop,
  onNewProfile,
  onSettings,
  packDragOver,
  setPackDragOver,
  importPack,
  dropPack,
  renamingId,
  renameValue,
  setRenameValue,
  commitRename
}: {
  profiles: Profile[]
  selectedId: string | null
  pstates: Record<string, { status: string; percent: number; text: string }>
  sidebarWidth: number
  onResize: (e: React.MouseEvent) => void
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  dragId: string | null
  setDragId: (id: string | null) => void
  drop: (targetId: string) => void
  onNewProfile: () => void
  onSettings: () => void
  packDragOver: boolean
  setPackDragOver: (v: boolean) => void
  importPack: () => void
  dropPack: (e: React.DragEvent) => void
  renamingId: string | null
  renameValue: string
  setRenameValue: (v: string) => void
  commitRename: () => void
}): React.JSX.Element {
  return (
    <>
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="profiles">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`profile ${p.id === selectedId ? 'active' : ''} ${dragId === p.id ? 'dragging' : ''}`}
              draggable={renamingId !== p.id}
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(p.id)}
              onDragEnd={() => setDragId(null)}
              onClick={() => renamingId !== p.id && onSelect(p.id)}
              onContextMenu={(e) => onContextMenu(e, p.id)}
            >
              <Avatar profile={p} size={34} />
              <div className="p-text">
                {renamingId === p.id ? (
                  <input
                    className="p-name-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenameValue('')
                    }}
                  />
                ) : (
                  <span className="p-name">{p.name}</span>
                )}
                <span className="p-meta">
                  {pstates[p.id]?.status === 'installing'
                    ? `${t('installingPercent')} ${pstates[p.id].percent}%`
                    : `${p.loader} ${p.mcVersion}`}
                </span>
              </div>
            </div>
          ))}
        </div>

        <button
          className={`import-btn ${packDragOver ? 'dragover' : ''}`}
          onClick={importPack}
          data-tip={t('importModpackTip')}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault()
              if (!packDragOver) setPackDragOver(true)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setPackDragOver(false)
          }}
          onDrop={dropPack}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v11m0 0l-4-4m4 4l4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span className="lbl">{packDragOver ? t('dropToImport') : t('importModpack')}</span>
        </button>

        <div className="side-foot">
          <button className="new" onClick={onNewProfile} data-tip={t('newProfile')}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="lbl">New profile</span>
          </button>
          <button className="gear" onClick={onSettings} data-tip={t('settings')}>
            <GearIcon />
          </button>
        </div>
      </aside>
      <div
        className={`sidebar-resize`}
        onMouseDown={onResize}
        title={t('dragToResize')}
      />
    </>
  )
}
