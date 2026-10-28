import type { CatalogAsset, CatalogLocation, DependencyReport, PrefabMaterialsResult, PrefabScope, RepoRef, SourceErrorCode, TreeEntry } from '@core/index'
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
  showItemInFolder: 'shell:show-item',
  catalogScan: 'catalog:scan',
  catalogPause: 'catalog:pause',
  catalogResume: 'catalog:resume',
  catalogStatus: 'catalog:status',
  catalogList: 'catalog:list',
  catalogWhere: 'catalog:where',
  catalogProgress: 'catalog:progress'
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

/** Background indexing of every branch (Phase 4.5). */
export interface CatalogStatus {
  state: 'idle' | 'running' | 'paused' | 'error'
  /** Branches listed in this run, out of `total`. */
  done: number
  total: number
  /** repo@branch being listed. */
  current?: string
  error?: IpcError
}

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
    /**
     * `instant` answers with what is known already, `quick` also searches nearby
     * files (both may be `partial`); `full` waits for the branch's GUID index.
     */
    resolve(repo: string, branch: string, path: string, root: string, mode?: 'instant' | 'quick' | 'full'): Promise<IpcResult<DependencyReport>>
    /** `background` reads (grid thumbnails) wait while the user is loading something. */
    readFile(repo: string, branch: string, path: string, background?: boolean): Promise<IpcResult<Uint8Array>>
    findByNames(repo: string, branch: string, names: string[], nearPath: string, root: string): Promise<IpcResult<Record<string, string | null>>>
    /** Progress of the one-off GUID index build for a commit. */
    onIndexProgress(listener: (progress: { done: number; total: number }) => void): () => void
    /** Materials that prefabs put on this model; `near` reads only related prefabs. */
    findPrefabMaterials(repo: string, branch: string, path: string, root: string, scope: PrefabScope, excludedFolders: string[]): Promise<IpcResult<PrefabMaterialsResult>>
    /** Bytes read so far by findPrefabMaterials. */
    onPrefabProgress(listener: (progress: { done: number; total: number }) => void): () => void
  }
  catalog: {
    /** Indexes every branch of `repo`, or of every repo when it is omitted; returns at once and runs in the background. */
    /** `current` (the open repo / branch) is indexed first. */
    scan(repo?: string, current?: { repo: string; branch?: string }): Promise<IpcResult<CatalogStatus>>
    pause(): Promise<IpcResult<CatalogStatus>>
    resume(): Promise<IpcResult<CatalogStatus>>
    status(): Promise<IpcResult<CatalogStatus>>
    /** Indexed assets of `repo` (every indexed repo when null), identical files grouped. */
    list(repo: string | null, excludedFolders: string[]): Promise<IpcResult<CatalogAsset[]>>
    /** Every repo, branch and path holding a file with this blob SHA. */
    whereIs(sha: string): Promise<IpcResult<CatalogLocation[]>>
    onStatus(listener: (status: CatalogStatus) => void): () => void
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
