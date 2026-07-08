import type { ModHit, Profile, Settings } from './types'

// A fake window.beacon so the renderer runs in a plain browser for design work
// (see vite.web.config.ts). Never used in the real app — Electron's preload sets
// the real window.beacon, and main.tsx only installs this when that is absent.
export function installMock(): void {
  const profiles: Profile[] = [
    { id: '1', name: 'Fabric 1.20.1', mcVersion: '1.20.1', loader: 'fabric', created: 0, playtimeMs: 12_240_000 },
    { id: '2', name: 'Vanilla 1.8.9', mcVersion: '1.8.9', loader: 'vanilla', created: 0 }
  ]
  const settings: Settings = { username: 'Player', maxMemory: 2048, accentColor: '#ffffff', theme: 'system', discordRpc: true, language: 'en', java8: '', java17: '', java21: '', java25: '' }
  type Acc = { id: string; name: string; type: 'offline' | 'msa' }
  let accountState: { accounts: Acc[]; activeId: string | null } = {
    accounts: [
      { id: 'off-1', name: 'Player', type: 'offline' },
      { id: 'mock-1', name: 'Notch', type: 'msa' }
    ],
    activeId: 'off-1'
  }
  const h = (id: string, title: string, description: string, author: string, downloads: number, follows: number): ModHit => ({
    id,
    title,
    description,
    author,
    downloads,
    follows,
    iconUrl: '',
    updated: new Date(Date.now() - 5 * 86400000).toISOString(),
    slug: id
  })
  const hits: ModHit[] = [
    h('a', 'Fabric API', 'Lightweight and modular API providing common hooks and interoperability for mods.', 'modmuss50', 196_000_000, 32_500),
    h('b', 'Sodium', 'A high-performance rendering engine replacement that greatly improves frame rates.', 'CaffeineMC', 177_000_000, 38_300),
    h('c', 'Iris Shaders', 'A modern shaders mod compatible with existing OptiFine shader packs.', 'coderbot', 138_000_000, 27_500),
    h('d', 'Cloth Config API', 'Configuration library for Minecraft mods.', 'shedaniel', 135_000_000, 21_000),
    h('e', 'Entity Culling', 'Uses async path-tracing to skip rendering hidden entities and block entities.', 'tr7zw', 129_000_000, 18_400)
  ]
  type Installed = { name: string; enabled: boolean; title?: string; author?: string; iconUrl?: string; version?: string; slug?: string; projectId?: string }
  // A tiny inline icon so installed rows show an avatar in the browser preview.
  const icon = (hue: number): string =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' rx='9' fill='hsl(${hue} 55% 45%)'/><text x='20' y='27' font-size='20' text-anchor='middle' fill='white'>◆</text></svg>`)}`
  const installed: Record<string, Installed[]> = {
    '1:mod': [
      { name: 'skinlayers3d-fabric-1.11.2-mc1.21.11.jar', enabled: true, title: '3D Skin Layers', author: 'tr7zw', version: '1.11.2', slug: '3dskinlayers', iconUrl: icon(20) },
      { name: 'BadOptimizations-2.4.1-1.21.11.jar', enabled: true, title: 'BadOptimizations', author: 'thosea', version: '2.4.1', slug: 'badoptimizations', iconUrl: icon(210) },
      { name: 'cloth-config-21.11.153-fabric.jar', enabled: false, title: 'Cloth Config API', author: 'shedaniel', version: '21.11.153+fabric', slug: 'cloth-config', iconUrl: icon(140) },
      { name: 'some-manual-mod-3.2.1.jar', enabled: true }
    ]
  }
  // Fake per-profile install simulation so the status bar / installs popover / buttons can be
  // exercised in the browser preview.
  type PState = { id: string; status: string; percent: number; text: string }
  let pcb: ((s: PState) => void) | null = null
  const timers: Record<string, ReturnType<typeof setInterval>> = {}
  const emit = (id: string, status: string, percent: number, text: string): void => {
    if (pcb) pcb({ id, status, percent, text })
  }
  const simulate = (id: string, name: string, thenRun: boolean): void => {
    let pct = 0
    clearInterval(timers[id])
    emit(id, 'installing', 0, 'Preparing…')
    timers[id] = setInterval(() => {
      pct += 6
      if (pct >= 100) {
        clearInterval(timers[id])
        if (thenRun) {
          emit(id, 'launching', 100, 'Launching…')
          setTimeout(() => emit(id, 'running', 100, 'Running'), 800)
        } else emit(id, 'ready', 100, 'Ready')
        return
      }
      emit(id, 'installing', pct, `Downloading ${name} — ${Math.round(pct * 6.6)} / 660 MB`)
    }, 450)
  }

  let updateCb: ((s: unknown) => void) | null = null
  ;(window as unknown as { beacon: unknown }).beacon = {
    appVersion: async () => '0.1.0',
    openLogs: async () => '',
    checkUpdate: async () => {
      updateCb?.({ state: 'checking' })
      setTimeout(() => updateCb?.({ state: 'available', version: '0.2.0' }), 700)
      return { ok: true }
    },
    downloadUpdate: async () => {
      let pct = 0
      const iv = setInterval(() => {
        pct += 20
        if (pct >= 100) {
          clearInterval(iv)
          updateCb?.({ state: 'ready', version: '0.2.0' })
        } else updateCb?.({ state: 'downloading', percent: pct })
      }, 400)
      return { ok: true }
    },
    installUpdate: async () => ({ ok: true }),
    onUpdateStatus: (cb: (s: unknown) => void) => {
      updateCb = cb
      // Surface an available update a moment after launch so the pill is visible in preview.
      setTimeout(() => updateCb?.({ state: 'available', version: '0.2.0' }), 1500)
      return () => {
        updateCb = null
      }
    },
    getSettings: async () => settings,
    saveSettings: async () => true,
    // Accounts — offline + fake licensed accounts so the switcher is visible in preview.
    listAccounts: async () => accountState,
    signIn: async () => {
      const id = String(Date.now())
      accountState = { accounts: [...accountState.accounts, { id, name: `MsPlayer${accountState.accounts.length}`, type: 'msa' }], activeId: id }
      return { ok: true, list: accountState }
    },
    addOfflineAccount: async (name: string) => {
      const id = String(Date.now())
      accountState = { accounts: [...accountState.accounts, { id, name: name || 'Player', type: 'offline' }], activeId: id }
      return accountState
    },
    renameAccount: async (id: string, name: string) => {
      accountState = { ...accountState, accounts: accountState.accounts.map((a) => (a.id === id ? { ...a, name } : a)) }
      return accountState
    },
    setActiveAccount: async (id: string | null) => {
      accountState = { ...accountState, activeId: id }
      return accountState
    },
    removeAccount: async (id: string) => {
      const accounts = accountState.accounts.filter((a) => a.id !== id)
      accountState = { accounts, activeId: accountState.activeId === id ? accounts[0]?.id ?? null : accountState.activeId }
      return accountState
    },
    onAuthChanged: () => () => {},
    listProfiles: async () => profiles,
    addProfile: async (name: string, mcVersion: string, loader: string) => {
      const p = { id: String(Date.now()), name: name || mcVersion, mcVersion, loader, created: 0 }
      setTimeout(() => simulate(p.id, p.name, false), 400)
      return p
    },
    pickImage: async () => null,
    pickModpack: async () => null,
    importModpack: async () => ({ ok: false, error: 'mock' }),
    searchModpacks: async () => ({ ok: true, total: 3, hits: hits.map((x) => ({ ...x, id: `modpack-${x.id}` })) }),
    importModpackFromModrinth: async () => ({ ok: true, id: 'mock' }),
    imageDataUrl: async () => null,
    renameProfile: async () => true,
    reorderProfiles: async () => true,
    deleteProfile: async () => true,
    openProfileFolder: async () => true,
    totalRam: async () => 16384,
    winMinimize: async () => {},
    winMaximize: async () => {},
    winClose: async () => {},
    discordActivity: async () => true,
    discordEnabled: async () => true,
    listVersions: async () => [
      { id: '24w14a', type: 'snapshot' },
      { id: '1.21', type: 'release' },
      { id: '1.20.4', type: 'release' },
      { id: '1.20.1', type: 'release' },
      { id: '1.19.4', type: 'release' },
      { id: '1.16.5', type: 'release' },
      { id: '1.12.2', type: 'release' },
      { id: '1.8.9', type: 'release' }
    ],
    // Vanilla → all; every other loader supports 1.12.2+ here (excludes 1.8.9) so the
    // dialog's filter + auto-switch behaviour is visible in the browser preview.
    loaderVersions: async (loader: string) =>
      loader === 'vanilla' ? null : ['1.21', '1.20.4', '1.20.1', '1.19.4', '1.16.5', '1.12.2'],
    loaderBuilds: async (loader: string) =>
      loader === 'vanilla'
        ? []
        : [
            { version: '0.16.9', stable: true },
            { version: '0.16.8', stable: true },
            { version: '0.16.7', stable: true },
            { version: '0.17.0-beta.1', stable: false }
          ],
    openContentFolder: async () => true,
    openUrl: async () => true,
    searchContent: async (_q: string, _mc: string, _l: string, _s: string, type: string) => ({
      ok: true,
      total: type === 'mod' ? 735 : 42,
      hits: hits.map((x) => ({ ...x, id: `${type}-${x.id}` }))
    }),
    installContent: async (
      profileId: string,
      id: string,
      _mc: string,
      _l: string,
      type: string,
      hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
    ) => {
      const key = `${profileId}:${type}`
      installed[key] = installed[key] || []
      installed[key].push({
        name: `${id}-1.0.0${type === 'mod' ? '.jar' : '.zip'}`,
        enabled: true,
        title: hit?.title,
        author: hit?.author,
        iconUrl: hit?.iconUrl || icon(300),
        version: '1.0.0',
        slug: hit?.slug
      })
      return { ok: true, filename: 'file' }
    },
    listContent: async (profileId: string, type: string) => (installed[`${profileId}:${type}`] ?? []).map((x) => ({ ...x })),
    enrichContent: async (profileId: string, type: string) => (installed[`${profileId}:${type}`] ?? []).map((x) => ({ ...x })),
    checkContentUpdates: async (profileId: string, type: string) => {
      const arr = installed[`${profileId}:${type}`] ?? []
      const out: Record<string, string> = {}
      for (const it of arr) if (it.title === 'BadOptimizations' && it.version !== '2.5.0') out[it.name] = '2.5.0'
      return out
    },
    updateContent: async (profileId: string, type: string, name: string) => {
      const it = (installed[`${profileId}:${type}`] ?? []).find((x) => x.name === name)
      if (it) it.version = '2.5.0'
      return { ok: true, filename: name }
    },
    toggleContent: async (profileId: string, type: string, name: string, enable: boolean) => {
      const arr = installed[`${profileId}:${type}`] || []
      const it = arr.find((x) => x.name === name)
      if (it) it.enabled = enable
      return true
    },
    removeContent: async (profileId: string, type: string, name: string) => {
      const key = `${profileId}:${type}`
      installed[key] = (installed[key] || []).filter((x) => x.name !== name)
      return true
    },
    getProject: async (idOrSlug: string) => {
      const key = idOrSlug.replace(/^[a-z]+-/, '')
      const hit = hits.find((h) => h.slug === idOrSlug || h.id === idOrSlug || h.id === key) || hits[0]
      return {
        ok: true,
        project: {
          id: hit.id,
          slug: hit.slug,
          title: hit.title,
          description: hit.description,
          body: `${hit.title}\n\n${hit.description}\n\n## Features\n- Blazing fast\n- Lightweight\n- Fully configurable\n\nDrop it in your mods folder or hit Install above. Compatible with Fabric and Quilt.`,
          iconUrl: hit.iconUrl || icon(120),
          author: hit.author,
          downloads: hit.downloads,
          follows: hit.follows,
          categories: ['optimization', 'utility'],
          gallery: [],
          source: 'https://github.com/example/project',
          issues: 'https://github.com/example/project/issues',
          updated: hit.updated
        }
      }
    },
    getPathForFile: (file: File) => file.name,
    addContentFiles: async (profileId: string, type: string, paths: string[]) => {
      const key = `${profileId}:${type}`
      installed[key] = installed[key] || []
      const added: string[] = []
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || p
        if (!/\.(jar|zip)$/i.test(name)) continue
        installed[key].push({ name, enabled: true })
        added.push(name)
      }
      return added
    },
    launch: async (id: string) => {
      const p = profiles.find((x) => x.id === id)
      simulate(id, p?.name ?? 'Minecraft', true)
      return { ok: true }
    },
    stop: async () => true,
    cancelInstall: async (id: string) => {
      clearInterval(timers[id])
      emit(id, 'idle', 0, '')
      return true
    },
    pickJava: async () => null,
    detectJava: async () => ({ ok: false }),
    detectAllJava: async () => ({}),
    installJava: async () => ({ ok: false, error: 'mock' }),
    onStatus: () => () => {},
    onProgress: () => () => {},
    onLog: () => () => {},
    onToast: () => () => {},
    onWinState: () => () => {},
    onProfilesChanged: () => () => {},
    onProfileState: (cb: (s: PState) => void) => {
      pcb = cb
      return () => {
        pcb = null
      }
    }
  }
}
