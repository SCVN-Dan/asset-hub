import type { CatalogAsset, CatalogLocation, DependencyReport, FactKind, PrefabMaterialsResult, PrefabScope, RepoRef, SourceErrorCode, TreeEntry } from '@core/index'
import type { StatsSummary } from '@core/checks/playable'
import type { Settings } from './settings'

export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  chooseFolder: 'dialog:choose-folder',
  isUnityProject: 'fs:is-unity-project',
  deepLink: 'app:deep-link',
  takeDeepLink: 'app:take-deep-link',
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
  knownAssets: 'assets:known-assets',
  knownProgress: 'assets:known-progress',
  getThumbs: 'thumbs:get',
  saveThumb: 'thumbs:save',
  cacheUsage: 'cache:usage',
  sharedIndexStatus: 'sharedIndex:status',
  sharedIndexImport: 'sharedIndex:import',
  sharedIndexExport: 'sharedIndex:export',
  sharedIndexProgress: 'sharedIndex:progress',
  clearCache: 'cache:clear',
  getStats: 'stats:get',
  saveStats: 'stats:save',
  exportPackage: 'export:unitypackage',
  exportProgress: 'export:progress',
  showItemInFolder: 'shell:show-item',
  saveFile: 'assets:save-file',
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
  layout: 'source' | 'grouped' | 'byType'
  /** Leave out textures that were only matched by file name. */
  skipByName: boolean
  /** More repo paths to include, e.g. materials found on prefabs (with .meta). */
  extraFiles: string[]
  /** PNG previews keyed by repo path. */
  previews: Record<string, Uint8Array>
  /** Default file name in the save dialog. */
  suggestedName: string
  /** Unity project the package is meant for (read only): files it already has are left out or reported. */
  targetProject?: string
  /** Leave out files the project has under another GUID, pointing references at its copy. */
  reuseExisting?: boolean
}

/** What the package does to the target project. Paths of the project are "Assets/…". */
export interface TargetReport {
  project: string
  /** Already there with the same GUID and content: left out. */
  same: number
  /** Same content under another GUID: left out, references point at the project's file. */
  reused: Array<{ path: string; existing: string }>
  /** Same GUID, other content: Unity will replace the project's file. */
  overwrite: Array<{ path: string; existing: string }>
  /** Path taken by another asset: Unity will import it as "Name 1". */
  renamed: Array<{ path: string; existing: string }>
  /** Shaders the project has under the same name (other GUID): left out, materials use the project's. */
  shaderByName: Array<{ path: string; existing: string }>
  /** Shaders the project has under the same GUID with other content: left out, the project's version is kept. */
  shaderKept: Array<{ path: string; existing: string }>
  /** Shaders imported although the project has one by the same name. */
  shaderClash: Array<{ path: string; existing: string }>
  /** Materials switched to a project shader by `.assethub/shader-mapping.json` ("existing" = "from → to"). */
  shaderMapped: Array<{ path: string; existing: string }>
  /** Exported assets using package scripts the project lacks ("existing" = their GUIDs, shortened): "Missing Script" after import. */
  missingScripts: Array<{ path: string; existing: string }>
  /** Problems with the mapping file (rules skipped). */
  mappingErrors: string[]
  /** URP versions of the source and target projects, when they differ. */
  urp?: { source: string; target?: string }
}

export interface ExportResult {
  canceled: boolean
  path?: string
  assets?: number
  bytes?: number
  skipped?: Array<{ path: string; reason: 'noMeta' | 'noGuid' | 'duplicateGuid' }>
  target?: TargetReport
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

/** Bytes the cache folder holds, by kind. */
export interface CacheUsage {
  /** Downloaded files, listings and indexes (count toward the size limit). */
  downloads: number
  thumbs: number
  /** Git clones, measurements and the rest. */
  other: number
}

/** What a shared index folder holds (`manifest.json`). */
export interface SharedIndexManifest {
  format: 1
  /** ISO time it was written; a newer one is taken in. */
  exportedAt: string
  /** GitHub login of who wrote it. */
  exportedBy?: string
  /** Asset types indexed (handler ids); an index made for other types is left alone. */
  types: string
  repos: Array<{ repo: string; branches: number; commits: number }>
  thumbs: number
  stats: number
}

/** Counts of what an import took in, or an export wrote. */
export interface SharedIndexResult {
  commits: number
  facts: number
  stats: number
  thumbs: number
}

export interface SharedIndexStatus {
  state: 'idle' | 'importing' | 'exporting' | 'error'
  error?: string
  /** In the shared folder now. */
  manifest?: SharedIndexManifest
  /** `exportedAt` of the index taken in last. */
  importedAt?: string
  last?: SharedIndexResult
  lastAction?: 'imported' | 'exported'
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
  /** The folder has Assets and ProjectSettings (read only). */
  isUnityProject(path: string): Promise<boolean>
  /** An assethub:// link that opened the app, if any (asked once the UI can open it). */
  takeDeepLink(): Promise<string | null>
  /** A link arrived while the app runs: take it with takeDeepLink. */
  onDeepLink(listener: () => void): () => void
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
    /** Asks where to save, then writes the file itself (real contents for LFS files). */
    saveFile(repo: string, branch: string, path: string): Promise<IpcResult<{ canceled: boolean; path?: string; bytes?: number }>>
    /** Bytes read so far by findPrefabMaterials. */
    onPrefabProgress(listener: (progress: { done: number; total: number }) => void): () => void
    /** Blob SHAs of the branch's assets of a kind known by reading them (effects, sprites, TextMeshPro fonts); reads files not seen before. */
    knownAssets(repo: string, branch: string, kind: FactKind): Promise<IpcResult<string[]>>
    /** Bytes read so far by knownAssets, with what was just found. */
    onKnownProgress(listener: (kind: FactKind, progress: { done: number; total: number; found?: string[] }) => void): () => void
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
    /** URLs of the thumbnails rendered earlier, for those of `keys` that have one. */
    get(keys: string[]): Promise<Record<string, string>>
    save(key: string, dataUrl: string): Promise<void>
  }
  /** A catalog, facts, measurements and thumbnails shared through a folder (`Settings.sharedIndexDir`). */
  sharedIndex: {
    status(): Promise<IpcResult<SharedIndexStatus>>
    /** Takes in the folder's index now, even one taken in before. */
    import(): Promise<IpcResult<SharedIndexStatus>>
    /** Writes this app's index there (after taking in what is already there). */
    export(): Promise<IpcResult<SharedIndexStatus>>
    onStatus(listener: (status: SharedIndexStatus) => void): () => void
  }
  cache: {
    /** Bytes the cache folder holds, by kind. */
    usage(): Promise<IpcResult<CacheUsage>>
    /** Empties downloaded files (thumbnails and measurements stay). */
    clear(): Promise<IpcResult<void>>
  }
  /** Model measurements by blob SHA, for ranking results without opening them. */
  stats: {
    get(keys: string[]): Promise<Record<string, StatsSummary>>
    save(key: string, summary: StatsSummary): Promise<void>
  }
  exporter: {
    /** Asks where to save, then builds the .unitypackage. */
    unityPackage(request: ExportRequest): Promise<IpcResult<ExportResult>>
    onProgress(listener: (progress: ExportProgress) => void): () => void
    showInFolder(path: string): Promise<void>
  }
}
