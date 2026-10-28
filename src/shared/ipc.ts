import type { DependencyReport, PrefabMaterialsResult, PrefabScope, RepoRef, SourceErrorCode, TreeEntry } from '@core/index'
import type { Settings } from './settings'

export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  chooseFolder: 'dialog:choose-folder',
  authStatus: 'auth:status',
  signInWithToken: 'auth:sign-in-token',
  signInWithGh: 'auth:sign-in-gh',
  ghWebLogin: 'auth:gh-web-login',
  cancelGhWebLogin: 'auth:gh-web-login-cancel',
  ghLoginPrompt: 'auth:gh-login-prompt',
  installGh: 'tools:install-gh',
  installProgress: 'tools:install-progress',
  signOut: 'auth:sign-out',
  listRepos: 'source:list-repos',
  listBranches: 'source:list-branches',
  listTree: 'source:list-tree',
  openExternal: 'shell:open-external',
  resolveAsset: 'assets:resolve',
  readFile: 'assets:read-file',
  findByNames: 'assets:find-by-names',
  indexProgress: 'assets:index-progress',
  findPrefabMaterials: 'assets:find-prefab-materials',
  prefabProgress: 'assets:prefab-progress',
  getThumbs: 'thumbs:get',
  saveThumb: 'thumbs:save',
  exportPackage: 'export:unitypackage',
  exportProgress: 'export:progress',
  showItemInFolder: 'shell:show-item'
} as const

/** Error codes that can cross IPC; the UI shows `errors.<code>`. */
export type AppErrorCode = SourceErrorCode | 'ghNotFound' | 'ghNotLoggedIn' | 'emptyToken' | 'ghInstallFailed'

export type InstallProgress = { stage: 'download'; received: number; total: number } | { stage: 'verify' } | { stage: 'extract' }

export interface ExportRequest {
  repo: string
  branch: string
  root: string
  /** Repo paths of the models to export; their dependencies are added automatically. */
  paths: string[]
  layout: 'source' | 'grouped'
  /** Leave out textures that were only matched by file name. */
  skipByName: boolean
  /** More repo paths to include, e.g. materials found on prefabs (with .meta). */
  extraFiles: string[]
  /** PNG previews keyed by repo path. */
  previews: Record<string, Uint8Array>
  /** Default file name in the save dialog. */
  suggestedName: string
}

export interface ExportResult {
  canceled: boolean
  path?: string
  assets?: number
  bytes?: number
  skipped?: Array<{ path: string; reason: 'noMeta' | 'noGuid' | 'duplicateGuid' }>
}

export type ExportProgress = { stage: 'resolve' | 'download' | 'write'; done: number; total: number }

export interface IpcError {
  code: AppErrorCode
  message: string
  resetAt?: number
  ssoUrl?: string
}

/** Errors are returned as values: Electron flattens thrown errors into plain strings. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export type AuthMethod = 'gh' | 'pat'

export interface AuthStatus {
  signedIn: boolean
  login?: string
  method?: AuthMethod
  /** False when the OS keychain was unavailable and the token lives only in memory. */
  persisted?: boolean
}

/** API exposed to the renderer as `window.api` by the preload script. */
export interface AssetHubApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** Opens a folder picker; resolves to null when cancelled. */
  chooseFolder(): Promise<string | null>
  /** Opens an https URL in the system browser. */
  openExternal(url: string): Promise<void>
  auth: {
    status(): Promise<IpcResult<AuthStatus>>
    signInWithToken(token: string): Promise<IpcResult<AuthStatus>>
    signInWithGh(): Promise<IpcResult<AuthStatus>>
    /** Logs gh in through the browser (device code), then signs in with it. */
    ghWebLogin(): Promise<IpcResult<AuthStatus>>
    cancelGhWebLogin(): Promise<void>
    /** Fires with the one-time code while ghWebLogin waits; returns an unsubscribe function. */
    onGhLoginPrompt(listener: (prompt: { code: string; url: string }) => void): () => void
    signOut(): Promise<IpcResult<AuthStatus>>
  }
  tools: {
    /** Downloads and verifies GitHub CLI into the app's own folder. */
    installGh(): Promise<IpcResult<{ version: string }>>
    onInstallProgress(listener: (progress: InstallProgress) => void): () => void
  }
  source: {
    listRepos(): Promise<IpcResult<RepoRef[]>>
    listBranches(repo: string): Promise<IpcResult<string[]>>
    listTree(repo: string, branch: string): Promise<IpcResult<TreeEntry[]>>
  }
  assets: {
    /** Materials, textures and shaders of one asset. Repo paths throughout. */
    resolve(repo: string, branch: string, path: string, root: string): Promise<IpcResult<DependencyReport>>
    readFile(repo: string, branch: string, path: string): Promise<IpcResult<Uint8Array>>
    findByNames(repo: string, branch: string, names: string[], nearPath: string, root: string): Promise<IpcResult<Record<string, string | null>>>
    /** Progress of the one-off GUID index build for a commit. */
    onIndexProgress(listener: (progress: { done: number; total: number }) => void): () => void
    /** Materials that prefabs put on this model; `near` reads only related prefabs. */
    findPrefabMaterials(repo: string, branch: string, path: string, root: string, scope: PrefabScope, excludedFolders: string[]): Promise<IpcResult<PrefabMaterialsResult>>
    /** Bytes read so far by findPrefabMaterials. */
    onPrefabProgress(listener: (progress: { done: number; total: number }) => void): () => void
  }
  thumbs: {
    get(keys: string[]): Promise<Record<string, string>>
    save(key: string, dataUrl: string): Promise<void>
  }
  exporter: {
    /** Asks where to save, then builds the .unitypackage. */
    unityPackage(request: ExportRequest): Promise<IpcResult<ExportResult>>
    onProgress(listener: (progress: ExportProgress) => void): () => void
    showInFolder(path: string): Promise<void>
  }
}
