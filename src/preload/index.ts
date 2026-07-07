import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // app / updates
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: unknown) => void) => {
    const l = (_e: unknown, s: unknown): void => cb(s)
    ipcRenderer.on('updateStatus', l)
    return () => ipcRenderer.removeListener('updateStatus', l)
  },
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:set', s),
  // profiles
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addProfile: (name: string, mcVersion: string, loader: string, loaderVersion?: string, avatarSrc?: string) =>
    ipcRenderer.invoke('profiles:add', { name, mcVersion, loader, loaderVersion, avatarSrc }),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickModpack: () => ipcRenderer.invoke('dialog:pickModpack'),
  importModpack: (filePath: string) => ipcRenderer.invoke('modpack:import', filePath),
  // Resolve the absolute path of a dropped File (Electron 43 removed File.path).
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  imageDataUrl: (path: string) => ipcRenderer.invoke('image:dataUrl', path),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  renameProfile: (id: string, name: string) => ipcRenderer.invoke('profiles:rename', { id, name }),
  reorderProfiles: (ids: string[]) => ipcRenderer.invoke('profiles:reorder', ids),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
  openProfileFolder: (id: string) => ipcRenderer.invoke('profiles:openFolder', id),
  openContentFolder: (id: string, type: string) => ipcRenderer.invoke('content:openFolder', { id, type }),
  openUrl: (url: string) => ipcRenderer.invoke('app:openUrl', url),
  totalRam: () => ipcRenderer.invoke('system:totalRam'),
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winMaximize: () => ipcRenderer.invoke('window:maximize'),
  winClose: () => ipcRenderer.invoke('window:close'),
  discordActivity: (profile: string | null) => ipcRenderer.invoke('discord:activity', { profile }),
  discordEnabled: (v: boolean) => ipcRenderer.invoke('discord:enabled', v),
  onWinState: (cb: (s: { maximized: boolean }) => void) => {
    const l = (_e: unknown, s: { maximized: boolean }) => cb(s)
    ipcRenderer.on('winState', l)
    return () => ipcRenderer.removeListener('winState', l)
  },
  onProfileState: (cb: (s: { id: string; status: string; percent: number; text: string }) => void) => {
    const l = (_e: unknown, s: { id: string; status: string; percent: number; text: string }) => cb(s)
    ipcRenderer.on('profileState', l)
    return () => ipcRenderer.removeListener('profileState', l)
  },
  onProfilesChanged: (cb: () => void) => {
    const l = (): void => cb()
    ipcRenderer.on('profilesChanged', l)
    return () => ipcRenderer.removeListener('profilesChanged', l)
  },
  // versions
  listVersions: (showSnapshots: boolean) => ipcRenderer.invoke('versions:list', showSnapshots),
  loaderVersions: (loader: string) => ipcRenderer.invoke('loaders:versions', loader),
  loaderBuilds: (loader: string, mcVersion: string) => ipcRenderer.invoke('loaders:builds', { loader, mcVersion }),
  // launch
  launch: (profileId: string) => ipcRenderer.invoke('game:launch', profileId),
  stop: () => ipcRenderer.invoke('game:stop'),
  cancelInstall: (id: string) => ipcRenderer.invoke('install:cancel', id),
  // content (mods / resource packs / data packs / shaders)
  searchContent: (query: string, mcVersion: string, loader: string, sort: string, type: string, offset: number) =>
    ipcRenderer.invoke('content:search', { query, mcVersion, loader, sort, type, offset }),
  installContent: (
    profileId: string,
    id: string,
    mcVersion: string,
    loader: string,
    type: string,
    hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
  ) => ipcRenderer.invoke('content:install', { profileId, id, mcVersion, loader, type, hit }),
  listContent: (profileId: string, type: string) => ipcRenderer.invoke('content:list', { profileId, type }),
  enrichContent: (profileId: string, type: string) => ipcRenderer.invoke('content:enrich', { profileId, type }),
  getProject: (idOrSlug: string) => ipcRenderer.invoke('content:project', idOrSlug),
  checkContentUpdates: (profileId: string, type: string) => ipcRenderer.invoke('content:checkUpdates', { profileId, type }),
  updateContent: (profileId: string, type: string, name: string) => ipcRenderer.invoke('content:update', { profileId, type, name }),
  toggleContent: (profileId: string, type: string, name: string, enable: boolean) =>
    ipcRenderer.invoke('content:toggle', { profileId, type, name, enable }),
  removeContent: (profileId: string, type: string, name: string) => ipcRenderer.invoke('content:remove', { profileId, type, name }),
  addContentFiles: (profileId: string, type: string, paths: string[]) => ipcRenderer.invoke('content:addFiles', { profileId, type, paths }),
  // java
  pickJava: () => ipcRenderer.invoke('dialog:pickJava'),
  detectJava: (major: number) => ipcRenderer.invoke('java:detect', major),
  installJava: (major: number) => ipcRenderer.invoke('java:install', major),
  // events
  onStatus: (cb: (s: { phase: string; text: string }) => void) => {
    const l = (_e: unknown, s: { phase: string; text: string }) => cb(s)
    ipcRenderer.on('status', l)
    return () => ipcRenderer.removeListener('status', l)
  },
  onProgress: (cb: (p: { percent: number }) => void) => {
    const l = (_e: unknown, p: { percent: number }) => cb(p)
    ipcRenderer.on('progress', l)
    return () => ipcRenderer.removeListener('progress', l)
  },
  onLog: (cb: (line: string) => void) => {
    const l = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('log', l)
    return () => ipcRenderer.removeListener('log', l)
  },
  onToast: (cb: (t: { text: string }) => void) => {
    const l = (_e: unknown, t: { text: string }) => cb(t)
    ipcRenderer.on('toast', l)
    return () => ipcRenderer.removeListener('toast', l)
  }
}

contextBridge.exposeInMainWorld('beacon', api)
