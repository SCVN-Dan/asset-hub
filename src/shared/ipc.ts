import type { RepoRef, SourceErrorCode, TreeEntry } from '@core/index'
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
  openExternal: 'shell:open-external'
} as const

/** Error codes that can cross IPC; the UI shows `errors.<code>`. */
export type AppErrorCode = SourceErrorCode | 'ghNotFound' | 'ghNotLoggedIn' | 'emptyToken' | 'ghInstallFailed'

export type InstallProgress = { stage: 'download'; received: number; total: number } | { stage: 'verify' } | { stage: 'extract' }

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
}
