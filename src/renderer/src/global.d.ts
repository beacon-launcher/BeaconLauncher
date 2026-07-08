import type { Profile, Settings, ModHit, ContentType, ContentItem, ProjectDetail, AccountsState } from './types'

declare global {
  interface Window {
    beacon: {
      appVersion(): Promise<string>
      openLogs(): Promise<string>
      checkUpdate(): Promise<{ ok: boolean; dev?: boolean; error?: string }>
      downloadUpdate(): Promise<{ ok: boolean; manual?: boolean; error?: string }>
      installUpdate(): Promise<{ ok: boolean }>
      onUpdateStatus(
        cb: (s: { state: string; version?: string; percent?: number; message?: string; manual?: boolean }) => void
      ): () => void
      getSettings(): Promise<Settings>
      saveSettings(s: Settings): Promise<boolean>
      listAccounts(): Promise<AccountsState>
      signIn(): Promise<{ ok: boolean; list?: AccountsState; error?: string }>
      addOfflineAccount(name: string): Promise<AccountsState>
      renameAccount(id: string, name: string): Promise<AccountsState>
      setActiveAccount(id: string | null): Promise<AccountsState>
      removeAccount(id: string): Promise<AccountsState>
      onAuthChanged(cb: (s: AccountsState) => void): () => void
      listProfiles(): Promise<Profile[]>
      addProfile(name: string, mcVersion: string, loader: string, loaderVersion?: string, avatarSrc?: string): Promise<Profile>
      pickImage(): Promise<string | null>
      pickModpack(): Promise<string | null>
      importModpack(filePath: string): Promise<{ ok: boolean; id?: string; error?: string }>
      searchModpacks(query: string, sort: string, offset: number): Promise<{ ok: boolean; hits?: ModHit[]; total?: number; error?: string }>
      importModpackFromModrinth(projectId: string): Promise<{ ok: boolean; id?: string; error?: string }>
      getPathForFile(file: File): string
      imageDataUrl(path: string): Promise<string | null>
      writeClipboard(text: string): Promise<boolean>
      renameProfile(id: string, name: string): Promise<boolean>
      reorderProfiles(ids: string[]): Promise<boolean>
      deleteProfile(id: string): Promise<boolean>
      openProfileFolder(id: string): Promise<boolean>
      openContentFolder(id: string, type: ContentType): Promise<boolean>
      openUrl(url: string): Promise<boolean>
      totalRam(): Promise<number>
      winMinimize(): Promise<void>
      winMaximize(): Promise<void>
      winClose(): Promise<void>
      discordActivity(profile: string | null): Promise<boolean>
      discordEnabled(v: boolean): Promise<boolean>
      onWinState(cb: (s: { maximized: boolean }) => void): () => void
      onProfileState(cb: (s: { id: string; status: string; percent: number; text: string }) => void): () => void
      onProfilesChanged(cb: () => void): () => void
      listVersions(showSnapshots: boolean): Promise<{ id: string; type: string }[]>
      loaderVersions(loader: string): Promise<string[] | null>
      loaderBuilds(loader: string, mcVersion: string): Promise<{ version: string; stable: boolean }[]>
      launch(profileId: string): Promise<{ ok: boolean; error?: string }>
      stop(): Promise<boolean>
      cancelInstall(id: string): Promise<boolean>
      searchContent(
        query: string,
        mcVersion: string,
        loader: string,
        sort: string,
        type: ContentType,
        offset: number
      ): Promise<{ ok: boolean; hits?: ModHit[]; total?: number; error?: string }>
      installContent(
        profileId: string,
        id: string,
        mcVersion: string,
        loader: string,
        type: ContentType,
        hit?: { title?: string; author?: string; iconUrl?: string; slug?: string }
      ): Promise<{ ok: boolean; filename?: string; error?: string }>
      listContent(profileId: string, type: ContentType): Promise<ContentItem[]>
      enrichContent(profileId: string, type: ContentType): Promise<ContentItem[]>
      getProject(idOrSlug: string): Promise<{ ok: boolean; project?: ProjectDetail | null; error?: string }>
      checkContentUpdates(profileId: string, type: ContentType): Promise<Record<string, string>>
      updateContent(profileId: string, type: ContentType, name: string): Promise<{ ok: boolean; filename?: string; error?: string }>
      toggleContent(profileId: string, type: ContentType, name: string, enable: boolean): Promise<boolean>
      removeContent(profileId: string, type: ContentType, name: string): Promise<boolean>
      addContentFiles(profileId: string, type: ContentType, paths: string[]): Promise<string[]>
      pickJava(): Promise<string | null>
      detectJava(major: number): Promise<{ ok: boolean; path?: string }>
      detectAllJava(majors: number[]): Promise<Record<number, string>>
      installJava(major: number): Promise<{ ok: boolean; path?: string; error?: string }>
      onStatus(cb: (s: { phase: string; text: string }) => void): () => void
      onProgress(cb: (p: { percent: number }) => void): () => void
      onLog(cb: (line: string) => void): () => void
      onToast(cb: (t: { text: string }) => void): () => void
    }
  }
}
