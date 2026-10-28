import { join } from 'path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, shell } from 'electron'
import { createDefaultRegistry, SourceError, type RepoRef } from '@core/index'
import { GitHubClient, type FetchLike } from '@core/github/client'
import { GitHubAssetSource } from '@core/github/source'
import { IPC, type AuthMethod, type CatalogStatus, type AuthStatus, type ExportRequest, type IpcError, type IpcResult } from '@shared/ipc'
import { AuthError, AuthStore, ghWebLogin, readGhToken, setManagedGh, type GhLoginPrompt } from './auth'
import { exportUnityPackage } from './exporter'
import { installGh, readInstalledGh } from './ghInstaller'
import { hasGit, listTreeWithGit, readBlobsWithGit } from './gitTree'
import { FileBlobCache, FileCommitCache, StatsStore, ThumbnailStore } from './caches'
import { CatalogService } from './catalog'

interface Session {
  source: GitHubAssetSource
  catalog: CatalogService
  status: AuthStatus
  /** Repo list kept for a few minutes, for catalog scans. */
  repos?: { at: number; list: Promise<RepoRef[]> }
}

function toIpcError(err: unknown): IpcError {
  if (err instanceof SourceError) return { code: err.code, message: err.message, ...err.detail }
  if (err instanceof AuthError) return { code: err.code, message: err.message }
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

/** Requests for what the user is looking at; background catalog scans wait while any are running. */
let foreground = 0

/** Like `wrap`, and marks the request as foreground work. */
async function wrapForeground<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  foreground++
  try {
    return await wrap(fn)
  } finally {
    foreground--
  }
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
  const statsStore = new StatsStore(options.cacheDir)
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
      gitFallback: (repo, commit) => listTreeWithGit(options.cacheDir(), repo, commit, token.trim()),
      backgroundGitFallback: async (repo, commit) => {
        if (!(await hasGit())) throw new SourceError('truncated', 'Repository tree is too large for the GitHub API')
        return listTreeWithGit(options.cacheDir(), repo, commit, token.trim(), true)
      },
      readBlobsBulk: async (repo, oids) => {
        if (!(await hasGit())) throw new Error('git is not available')
        return readBlobsWithGit(options.cacheDir(), repo, oids, token.trim())
      }
    })
    session?.catalog.stop()
    const catalog = new CatalogService(
      source,
      () => join(options.cacheDir(), 'catalog'),
      (entry) => registry.classify(entry) !== undefined,
      (path) => registry.classify({ path, type: 'blob', sha: '' })?.id,
      () => foreground > 0,
      registry.all().map((h) => h.id).join(','),
      (status: CatalogStatus) => BrowserWindow.getAllWindows().forEach((w) => !w.webContents.isDestroyed() && w.webContents.send(IPC.catalogProgress, status))
    )
    session = { source, catalog, status: { signedIn: true, login: user.login, method, persisted } }
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
      // Offline or GitHub unreachable: try again on the next status check instead of signing out.
      if (err instanceof SourceError && (err.code === 'network' || err.code === 'rateLimited' || err.code === 'unknown')) restored = false
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
      session?.catalog.stop()
      session = undefined
      store.clear()
      return { signedIn: false }
    })
  )

  ipcMain.handle(IPC.listRepos, () => wrap(() => requireSession().listRepos()))
  ipcMain.handle(IPC.listBranches, (_e, repo: string) => wrap(() => requireSession().listBranches(String(repo))))
  ipcMain.handle(IPC.listTree, (_e, repo: string, branch: string) =>
    wrapForeground(async () => {
      const src = requireSession()
      const entries = await src.listTree(String(repo), String(branch))
      // Build the branch's GUID index in the background, so opening a model finds its dependencies at once.
      setTimeout(() => void src.warmGuidIndex(String(repo), String(branch)).catch(() => {}), 1500)
      return entries
    })
  )

  ipcMain.handle(IPC.resolveAsset, (event, repo: string, branch: string, path: string, root: string, mode: unknown) =>
    wrapForeground(() =>
      requireSession().resolve(
        String(repo),
        String(branch),
        String(path),
        String(root),
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.indexProgress, progress)
        },
        mode === 'instant' || mode === 'quick' ? mode : 'full'
      )
    )
  )
  ipcMain.handle(IPC.findPrefabMaterials, (event, repo: string, branch: string, path: string, root: string, scope: unknown, excluded: unknown) =>
    wrapForeground(() =>
      requireSession().findPrefabMaterials(
        String(repo),
        String(branch),
        String(path),
        String(root),
        scope === 'all' || scope === 'cached' || scope === 'known' ? scope : 'near',
        Array.isArray(excluded) ? excluded.map(String) : [],
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.prefabProgress, progress)
        }
      )
    )
  )
  ipcMain.handle(IPC.readFile, (_e, repo: string, branch: string, path: string, background: unknown) =>
    background === true
      ? wrap(async () => {
          // Grid thumbnails step aside while the user waits on something.
          while (foreground > 0) await new Promise((r) => setTimeout(r, 150))
          return requireSession().readFile(String(repo), String(branch), String(path))
        })
      : wrapForeground(() => requireSession().readFile(String(repo), String(branch), String(path)))
  )
  ipcMain.handle(IPC.findByNames, (_e, repo: string, branch: string, names: unknown, nearPath: string, root: string) =>
    wrapForeground(() =>
      requireSession().findByNames(String(repo), String(branch), Array.isArray(names) ? names.map(String) : [], String(nearPath), String(root))
    )
  )
  ipcMain.handle(IPC.exportPackage, (event, raw: ExportRequest) =>
    wrapForeground(async () => {
      const src = requireSession()
      const req: ExportRequest = {
        repo: String(raw.repo),
        branch: String(raw.branch),
        root: String(raw.root),
        paths: Array.isArray(raw.paths) ? raw.paths.map(String) : [],
        layout: raw.layout === 'grouped' ? 'grouped' : 'source',
        skipByName: raw.skipByName === true,
        extraFiles: Array.isArray(raw.extraFiles) ? raw.extraFiles.map(String) : [],
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
  const requireCatalog = (): CatalogService => {
    if (!session) throw new SourceError('unauthorized', 'Not signed in')
    return session.catalog
  }
  const repoList = (): Promise<RepoRef[]> => {
    const s = session!
    if (!s.repos || Date.now() - s.repos.at > 10 * 60_000) {
      const list = s.source.listRepos()
      s.repos = { at: Date.now(), list }
      list.catch(() => s.repos?.list === list && (s.repos = undefined))
    }
    return s.repos.list
  }
  ipcMain.handle(IPC.catalogScan, (_e, repo: unknown, current: unknown) =>
    wrap(async () => {
      const catalog = requireCatalog()
      const repos = await repoList()
      const wanted = typeof repo === 'string' ? repos.filter((r) => r.fullName === repo) : repos
      // Returns once branch lists are read; listing the branches goes on in the background.
      const open = current as { repo?: unknown; branch?: unknown } | undefined
      return catalog.scan(wanted, typeof open?.repo === 'string' ? { repo: open.repo, branch: typeof open.branch === 'string' ? open.branch : undefined } : undefined)
    })
  )
  ipcMain.handle(IPC.catalogPause, () => wrap(async () => requireCatalog().pause()))
  ipcMain.handle(IPC.catalogResume, () => wrap(async () => requireCatalog().resume()))
  ipcMain.handle(IPC.catalogStatus, () => wrap(async () => requireCatalog().status()))
  ipcMain.handle(IPC.catalogList, (_e, repo: unknown, excluded: unknown) =>
    wrap(() => requireCatalog().list(typeof repo === 'string' ? [repo] : [], Array.isArray(excluded) ? excluded.map(String) : []))
  )
  ipcMain.handle(IPC.catalogWhere, (_e, sha: unknown) => wrap(() => requireCatalog().whereIs(String(sha))))
  ipcMain.handle(IPC.getStats, (_e, keys: unknown) => statsStore.getMany(Array.isArray(keys) ? keys.map(String).slice(0, 20000) : []))
  ipcMain.handle(IPC.saveStats, (_e, key: unknown, summary: unknown) => (typeof key === 'string' ? statsStore.save(key, summary) : undefined))
  ipcMain.handle(IPC.getThumbs, (_e, keys: unknown) => thumbs.getMany(Array.isArray(keys) ? keys.map(String).slice(0, 5000) : []))
  ipcMain.handle(IPC.saveThumb, (_e, key: unknown, dataUrl: unknown) =>
    typeof key === 'string' && typeof dataUrl === 'string' ? thumbs.save(key, dataUrl) : undefined
  )
}
