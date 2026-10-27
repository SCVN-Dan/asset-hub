import { join } from 'path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, shell } from 'electron'
import { createDefaultRegistry, SourceError } from '@core/index'
import { GitHubClient, type FetchLike } from '@core/github/client'
import { GitHubAssetSource } from '@core/github/source'
import { IPC, type AuthMethod, type AuthStatus, type ExportRequest, type IpcError, type IpcResult } from '@shared/ipc'
import { AuthError, AuthStore, ghWebLogin, readGhToken, setManagedGh, type GhLoginPrompt } from './auth'
import { exportUnityPackage } from './exporter'
import { installGh, readInstalledGh } from './ghInstaller'
import { listTreeWithGit } from './gitTree'
import { FileBlobCache, FileCommitCache, ThumbnailStore } from './caches'

interface Session {
  source: GitHubAssetSource
  status: AuthStatus
}

function toIpcError(err: unknown): IpcError {
  if (err instanceof SourceError) return { code: err.code, message: err.message, ...err.detail }
  if (err instanceof AuthError) return { code: err.code, message: err.message }
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toIpcError(err) }
  }
}

/** Uses Chromium's network stack so system proxies and certificates apply. */
const electronFetch: FetchLike = (url, init) => net.fetch(url, init)

/** Owns the GitHub session in the main process; the token never reaches the renderer. */
export function registerGitHubIpc(options: { authFile: string; cacheDir: () => string; toolsDir: string }): void {
  const store = new AuthStore(options.authFile)
  const cache = new FileCommitCache(options.cacheDir)
  const blobCache = new FileBlobCache(options.cacheDir)
  const thumbs = new ThumbnailStore(options.cacheDir)
  const registry = createDefaultRegistry()
  let session: Session | undefined
  let restored = false
  const managed = readInstalledGh(options.toolsDir).then((info) => setManagedGh(info?.path))

  async function start(method: AuthMethod, token: string, persist: boolean): Promise<AuthStatus> {
    if (!token.trim()) throw new AuthError('emptyToken', 'Token is empty')
    const client = new GitHubClient(token.trim(), electronFetch)
    const user = await client.getUser()
    const persisted = persist ? store.save(method, token.trim()) : true
    const source = new GitHubAssetSource(client, {
      // Only asset files need their real LFS size; other LFS files stay flagged without a request.
      shouldResolveLfs: (entry) => registry.classify(entry) !== undefined,
      handlerFor: (entry) => registry.classify(entry),
      cache,
      blobCache,
      gitFallback: (repo, commit) => listTreeWithGit(options.cacheDir(), repo, commit, token.trim())
    })
    session = { source, status: { signedIn: true, login: user.login, method, persisted } }
    return session.status
  }

  /** Restores the previous sign-in once per app launch. */
  async function restore(): Promise<void> {
    if (restored) return
    restored = true
    await managed
    const saved = store.load()
    if (!saved) return
    try {
      const token = saved.method === 'gh' ? await readGhToken() : saved.token!
      await start(saved.method, token, false)
    } catch (err) {
      // A revoked token should not be retried on every launch.
      if (err instanceof SourceError && err.code === 'unauthorized') store.clear()
    }
  }

  const requireSession = (): GitHubAssetSource => {
    if (!session) throw new SourceError('unauthorized', 'Not signed in')
    return session.source
  }

  ipcMain.handle(IPC.authStatus, () =>
    wrap(async () => {
      await restore()
      return session?.status ?? { signedIn: false }
    })
  )
  ipcMain.handle(IPC.signInWithToken, (_e, token: unknown) => wrap(() => start('pat', typeof token === 'string' ? token : '', true)))
  ipcMain.handle(IPC.signInWithGh, () =>
    wrap(async () => {
      await managed
      return start('gh', await readGhToken(), true)
    })
  )

  // One browser login at a time. A second request (button pressed again, or the
  // renderer reloaded mid-login) joins the pending one and gets the same code.
  let pending: { done: Promise<void>; cancel(): void; prompt?: GhLoginPrompt; listeners: Set<Electron.WebContents> } | undefined
  const sendPrompt = (target: Electron.WebContents, prompt: GhLoginPrompt) => {
    if (!target.isDestroyed()) target.send(IPC.ghLoginPrompt, prompt)
  }

  ipcMain.handle(IPC.ghWebLogin, (event) =>
    wrap(async () => {
      await managed
      if (!pending) {
        const listeners = new Set<Electron.WebContents>()
        const login = ghWebLogin((prompt) => {
          if (!pending) return
          pending.prompt = prompt
          // Copied right away so the user never has to race to copy it.
          clipboard.writeText(prompt.code)
          listeners.forEach((wc) => sendPrompt(wc, prompt))
        })
        const current = { ...login, listeners }
        pending = current
        void login.done.catch(() => {}).finally(() => {
          if (pending === current) pending = undefined
        })
      }
      pending.listeners.add(event.sender)
      if (pending.prompt) sendPrompt(event.sender, pending.prompt)
      await pending.done
      return start('gh', await readGhToken(), true)
    })
  )
  ipcMain.handle(IPC.cancelGhWebLogin, () => pending?.cancel())

  ipcMain.handle(IPC.installGh, (event) =>
    wrap(async () => {
      try {
        const info = await installGh(options.toolsDir, electronFetch, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.installProgress, progress)
        })
        setManagedGh(info.path)
        return { version: info.version }
      } catch (err) {
        throw new AuthError('ghInstallFailed', err instanceof Error ? err.message : String(err))
      }
    })
  )
  // Never leave a gh process waiting in the background after the app quits.
  app.on('before-quit', () => pending?.cancel())
  ipcMain.handle(IPC.signOut, () =>
    wrap(async () => {
      session = undefined
      store.clear()
      return { signedIn: false }
    })
  )

  ipcMain.handle(IPC.listRepos, () => wrap(() => requireSession().listRepos()))
  ipcMain.handle(IPC.listBranches, (_e, repo: string) => wrap(() => requireSession().listBranches(String(repo))))
  ipcMain.handle(IPC.listTree, (_e, repo: string, branch: string) => wrap(() => requireSession().listTree(String(repo), String(branch))))

  ipcMain.handle(IPC.resolveAsset, (event, repo: string, branch: string, path: string, root: string) =>
    wrap(() =>
      requireSession().resolve(String(repo), String(branch), String(path), String(root), (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.indexProgress, progress)
      })
    )
  )
  ipcMain.handle(IPC.readFile, (_e, repo: string, branch: string, path: string) => wrap(() => requireSession().readFile(String(repo), String(branch), String(path))))
  ipcMain.handle(IPC.findByNames, (_e, repo: string, branch: string, names: unknown, nearPath: string, root: string) =>
    wrap(() =>
      requireSession().findByNames(String(repo), String(branch), Array.isArray(names) ? names.map(String) : [], String(nearPath), String(root))
    )
  )
  ipcMain.handle(IPC.exportPackage, (event, raw: ExportRequest) =>
    wrap(async () => {
      const src = requireSession()
      const req: ExportRequest = {
        repo: String(raw.repo),
        branch: String(raw.branch),
        root: String(raw.root),
        paths: Array.isArray(raw.paths) ? raw.paths.map(String) : [],
        layout: raw.layout === 'grouped' ? 'grouped' : 'source',
        skipByName: raw.skipByName === true,
        previews: Object.fromEntries(
          Object.entries(raw.previews && typeof raw.previews === 'object' ? raw.previews : {}).filter(([, v]) => v instanceof Uint8Array)
        ),
        suggestedName: String(raw.suggestedName || 'assets').replace(/[\\/:*?"<>|]/g, '_')
      }
      if (!req.paths.length) return { canceled: true }
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Export .unitypackage',
        defaultPath: join(app.getPath('downloads'), `${req.suggestedName}.unitypackage`),
        filters: [{ name: 'Unity Package', extensions: ['unitypackage'] }]
      }
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { canceled: true }
      const result = await exportUnityPackage(src, req, choice.filePath, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.exportProgress, progress)
      })
      return { canceled: false, ...result }
    })
  )
  ipcMain.handle(IPC.showItemInFolder, (_e, path: unknown) => {
    if (typeof path === 'string' && path.endsWith('.unitypackage')) shell.showItemInFolder(path)
  })
  ipcMain.handle(IPC.getThumbs, (_e, keys: unknown) => thumbs.getMany(Array.isArray(keys) ? keys.map(String).slice(0, 5000) : []))
  ipcMain.handle(IPC.saveThumb, (_e, key: unknown, dataUrl: unknown) =>
    typeof key === 'string' && typeof dataUrl === 'string' ? thumbs.save(key, dataUrl) : undefined
  )
}
