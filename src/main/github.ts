import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } from 'electron'
import { blenderMaterial, blenderScript, bundleFileNames, bundleTexturePaths, createDefaultRegistry, SourceError, type BundleMaterial, type FactKind, type RepoRef } from '@core/index'
import { GitHubClient, type FetchLike } from '@core/github/client'
import { GitHubAssetSource } from '@core/github/source'
import { IPC, type AuthMethod, type CatalogStatus, type AuthStatus, type ExportRequest, type IpcError, type IpcResult } from '@shared/ipc'
import { AuthError, AuthStore, ghLogout, ghWebLogin, readGhToken, setManagedGh, type GhLoginPrompt } from './auth'
import { exportUnityPackage } from './exporter'
import { findBlender, openInBlender, sweepBlenderTemp } from './blender'
import { zipFiles } from './zip'
import { isUnityProject } from './targetProject'
import { installGh, readInstalledGh } from './ghInstaller'
import { listRunningUnity, openInProcess } from './unityEditors'
import { hasGit, listTreeWithGit, prefetchBlobsWithGit, readBlobsWithGit } from './gitTree'
import { CacheJanitor, FileBlobCache, FileCommitCache, StatsStore, THUMB_SCHEME, ThumbnailStore } from './caches'
import { CatalogService } from './catalog'
import { SharedIndexService } from './sharedIndex'
import { IndexRepo } from './indexRepo'

interface Session {
  source: GitHubAssetSource
  catalog: CatalogService
  sharedIndex: SharedIndexService
  status: AuthStatus
  token: string
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
/** Checks for a newer shared index this often while signed in. */
const SHARED_INDEX_CHECK_MS = 30 * 60_000

export function registerGitHubIpc(options: { authFile: string; cacheDir: () => string; cacheLimit: () => number; sharedIndexDir: () => string | undefined; toolsDir: string }): { janitor: CacheJanitor; sharedIndexChanged(): void; account(): { login: string; token: string } | undefined } {
  const store = new AuthStore(options.authFile)
  const janitor = new CacheJanitor(options.cacheDir, options.cacheLimit)
  const cache = new FileCommitCache(options.cacheDir, janitor.noteWrite)
  const blobCache = new FileBlobCache(options.cacheDir, janitor.noteWrite)
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
      },
      prefetchBlobs: async (repo, oids) => {
        if (!(await hasGit())) return
        await prefetchBlobsWithGit(options.cacheDir(), repo, oids, token.trim())
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
    const types = registry.all().map((h) => h.id).join(',')
    const sharedIndex = new SharedIndexService(
      { catalog, source, stats: statsStore, thumbs },
      options.sharedIndexDir,
      () => join(options.cacheDir(), 'shared-index.json'),
      types,
      user.login,
      (status) => BrowserWindow.getAllWindows().forEach((w) => !w.webContents.isDestroyed() && w.webContents.send(IPC.sharedIndexProgress, status)),
      // Needs a real git; without one, only a shared folder works.
      (await hasGit()) ? new IndexRepo(join(options.cacheDir(), 'shared-index-repo'), () => token.trim()) : undefined
    )
    session = { source, catalog, sharedIndex, status: { signedIn: true, login: user.login, method, persisted }, token: token.trim() }
    // A teammate's index makes searching across branches instant: taken in right away when newer.
    void sharedIndex.check()
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
  ipcMain.handle(IPC.signOut, (_e, options: unknown) =>
    wrap(async () => {
      const was = session?.status
      // Signed in through gh: gh itself is logged out too when asked, or START would sign straight back in.
      if (was?.method === 'gh' && (options as { gh?: unknown } | undefined)?.gh === true) await ghLogout(was.login)
      session?.catalog.stop()
      session = undefined
      store.clear()
      return { signedIn: false }
    })
  )

  ipcMain.handle(IPC.listRepos, () => wrap(() => requireSession().listRepos()))
  ipcMain.handle(IPC.listBranches, (_e, repo: string) => wrap(() => requireSession().listBranches(String(repo))))
  ipcMain.handle(IPC.watchCheck, (_e, repo: unknown, branch: unknown, seen: unknown) =>
    wrap(async () => {
      const r = await requireSession().addedSince(String(repo), String(branch), typeof seen === 'string' ? seen : '')
      // Only files the hub lists as assets count as news (not scripts, .meta, scenes…).
      return { head: r.head, added: r.added.filter((f) => registry.classify({ path: f.path, type: 'blob', sha: f.sha })).map((f) => f.path), more: r.more }
    })
  )
  ipcMain.handle(IPC.listTree, (_e, repo: string, branch: string) =>
    wrapForeground(async () => {
      const src = requireSession()
      const entries = await src.listTree(String(repo), String(branch))
      // Build the branch's GUID index in the background, so opening a model finds its dependencies at once.
      setTimeout(() => void src.warmGuidIndex(String(repo), String(branch)).catch(() => {}), 1500)
      return entries
    })
  )

  // Grid thumbnails resolve in the background: counted as foreground, four of them running at once
  // kept every background read (their own models and textures) waiting, and no card was ever drawn.
  ipcMain.handle(IPC.resolveAsset, (event, repo: string, branch: string, path: string, root: string, mode: unknown, background: unknown) =>
    (background === true ? wrap : wrapForeground)(() =>
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
  ipcMain.handle(IPC.knownAssets, (event, repo: string, branch: string, kind: unknown) => {
    const k: FactKind = kind === 'sprites' || kind === 'tmpFonts' ? kind : 'effects'
    return wrap(() =>
      requireSession().knownAssets(String(repo), String(branch), k, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.knownProgress, k, progress)
      })
    )
  })
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
  /** An export request from the renderer, every field checked. */
  const exportRequest = (raw: ExportRequest): ExportRequest => ({
    repo: String(raw.repo),
    branch: String(raw.branch),
    root: String(raw.root),
    paths: Array.isArray(raw.paths) ? raw.paths.map(String) : [],
    layout: raw.layout === 'grouped' || raw.layout === 'byType' ? raw.layout : 'source',
    skipByName: raw.skipByName === true,
    extraFiles: Array.isArray(raw.extraFiles) ? raw.extraFiles.map(String) : [],
    previews: Object.fromEntries(
      Object.entries(raw.previews && typeof raw.previews === 'object' ? raw.previews : {}).filter(([, v]) => v instanceof Uint8Array)
    ),
    suggestedName: String(raw.suggestedName || 'assets').replace(/[\\/:*?"<>|]/g, '_'),
    reuseExisting: raw.reuseExisting !== false,
    stripScripts: raw.stripScripts === true
  })

  ipcMain.handle(IPC.exportPackage, (event, raw: ExportRequest) =>
    wrapForeground(async () => {
      const src = requireSession()
      const req = exportRequest(raw)
      // Compared only with a folder that is really a Unity project (read, never written).
      if (typeof raw.targetProject === 'string' && raw.targetProject && (await isUnityProject(raw.targetProject))) req.targetProject = raw.targetProject
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
  ipcMain.handle(IPC.unityEditors, () => listRunningUnity().catch(() => []))
  // Straight into an open Unity editor: the package goes to a temporary folder, compared with that
  // editor's own project (what it already has is left out), then opened in that editor — Unity shows
  // its import dialog, as when a package is double-clicked, but in the chosen one of several editors.
  ipcMain.handle(IPC.importToUnity, (event, raw: ExportRequest, pid: unknown) =>
    wrapForeground(async () => {
      const src = requireSession()
      const editor = (await listRunningUnity()).find((e) => e.pid === Number(pid))
      if (!editor) throw new Error('That Unity editor is no longer open')
      const req = { ...exportRequest(raw), targetProject: editor.projectPath }
      if (!req.paths.length) return { canceled: true, unity: editor.project }
      const dir = join(app.getPath('temp'), 'asset-hub-packages')
      await mkdir(dir, { recursive: true })
      const file = join(dir, `${req.suggestedName}.unitypackage`)
      const result = await exportUnityPackage(src, req, file, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.exportProgress, progress)
      })
      // The project has all of it already: an empty package would only make Unity show nothing.
      if ((result.assets ?? 0) > 0) await openInProcess(editor.pid, file)
      return { canceled: false, ...result, unity: editor.project }
    })
  )
  /** Files this app wrote, the only ones "Show in Finder" may reveal besides packages. */
  const saved = new Set<string>()
  ipcMain.handle(IPC.saveFile, (event, repo: unknown, branch: unknown, path: unknown) =>
    wrapForeground(async () => {
      const src = requireSession()
      const repoPath = String(path)
      const name = repoPath.split('/').pop() || 'file'
      const ext = name.includes('.') ? name.split('.').pop()! : ''
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: join(app.getPath('downloads'), name), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] }
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { canceled: true }
      const bytes = await src.readFile(String(repo), String(branch), repoPath)
      await writeFile(choice.filePath, bytes)
      saved.add(choice.filePath)
      return { canceled: false, path: choice.filePath, bytes: bytes.byteLength }
    })
  )
  ipcMain.handle(IPC.findBlender, () => findBlender().then((p) => !!p, () => false))
  // A model with its textures and a Blender script that rebuilds its materials: saved as one .zip, or opened in Blender.
  // A prefab comes as the GLB the renderer exported (`glb`); an FBX is read from the repo.
  ipcMain.handle(IPC.modelBundle, (event, repo: unknown, branch: unknown, path: unknown, rawMaterials: unknown, mode: unknown, glb: unknown) =>
    wrapForeground(async () => {
      const src = requireSession()
      const [r, b, model] = [String(repo), String(branch), String(path)]
      const materials: BundleMaterial[] = (Array.isArray(rawMaterials) ? rawMaterials : []).flatMap((m) =>
        m && typeof m.target === 'string'
          ? [
              {
                target: m.target,
                ...(typeof m.name === 'string' ? { name: m.name } : {}),
                ...(typeof m.mat === 'string' ? { mat: m.mat } : {}),
                ...(typeof m.shader === 'string' ? { shader: m.shader } : {}),
                textures: (Array.isArray(m.textures) ? m.textures : []).filter((t: { prop?: unknown; path?: unknown }) => typeof t?.prop === 'string' && typeof t?.path === 'string')
              }
            ]
          : []
      )
      const prefabGlb = glb instanceof Uint8Array ? glb : undefined
      const stem = (model.split('/').pop() || 'model').replace(/\.[^.]+$/, '')
      const modelName = prefabGlb ? `${stem}.glb` : model.split('/').pop() || 'model.fbx'
      const textures = bundleTexturePaths(materials)
      const names = bundleFileNames([`/${modelName}`, ...textures])
      let blender: string | undefined
      let target: string | undefined
      if (mode === 'blender') {
        blender = await findBlender()
        if (!blender) throw new Error('Blender is not installed')
      } else {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options = { defaultPath: join(app.getPath('downloads'), `${stem}.zip`), filters: [{ name: 'ZIP', extensions: ['zip'] }] }
        const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (choice.canceled || !choice.filePath) return { canceled: true }
        target = choice.filePath
      }
      // The model must come; a texture or .mat that fails to download is left out.
      // Read from the cache when there, never added to it: these files are only passed on.
      const optional = (p: string) => src.readFile(r, b, p, { keep: false }).catch(() => undefined)
      const [modelBytes, texBytes, matTexts] = await Promise.all([
        prefabGlb ?? src.readFile(r, b, model, { keep: false }),
        Promise.all(textures.map(optional)),
        Promise.all(materials.map((m) => (m.mat ? optional(m.mat).then((d) => d && new TextDecoder().decode(d)) : undefined)))
      ])
      const got = new Map(textures.flatMap((p, i) => (texBytes[i] ? [[p, texBytes[i]!] as const] : [])))
      const fileOf = (p: string) => (got.has(p) ? names.get(p) : undefined)
      const specs = materials.map((m, i) => blenderMaterial(m, matTexts[i], fileOf))
      const all = [
        { name: names.get(`/${modelName}`)!, data: modelBytes },
        ...[...got].map(([p, data]) => ({ name: names.get(p)!, data })),
        // Opened from the temporary folder, the script deletes it once everything is in Blender.
        { name: 'open_in_blender.py', data: new TextEncoder().encode(blenderScript(names.get(`/${modelName}`)!, specs, { cleanup: !target })) }
      ]
      if (target) {
        const zip = zipFiles(all)
        await writeFile(target, zip)
        saved.add(target)
        return { canceled: false, path: target, bytes: zip.byteLength, textures: got.size }
      }
      const temp = join(app.getPath('temp'), 'asset-hub-blender')
      await sweepBlenderTemp(temp)
      const dir = join(temp, `${stem}-${Date.now().toString(36)}`)
      await mkdir(dir, { recursive: true })
      await Promise.all(all.map((f) => writeFile(join(dir, f.name), f.data)))
      openInBlender(blender!, join(dir, 'open_in_blender.py'))
      return { canceled: false, path: dir, textures: got.size }
    })
  )
  ipcMain.handle(IPC.showItemInFolder, (_e, path: unknown) => {
    if (typeof path === 'string' && (path.endsWith('.unitypackage') || saved.has(path))) shell.showItemInFolder(path)
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
  ipcMain.handle(IPC.catalogList, (_e, repo: unknown, excluded: unknown, filter: unknown) => {
    const f = (filter ?? {}) as { repo?: unknown; branch?: unknown }
    return wrap(() =>
      requireCatalog().listing(typeof repo === 'string' ? [repo] : [], Array.isArray(excluded) ? excluded.map(String) : [], {
        ...(typeof f.repo === 'string' && f.repo ? { repo: f.repo } : {}),
        ...(typeof f.branch === 'string' && f.branch ? { branch: f.branch } : {})
      })
    )
  })
  ipcMain.handle(IPC.catalogWhere, (_e, sha: unknown) => wrap(() => requireCatalog().whereIs(String(sha))))
  ipcMain.handle(IPC.getStats, (_e, keys: unknown) => statsStore.getMany(Array.isArray(keys) ? keys.map(String).slice(0, 20000) : []))
  ipcMain.handle(IPC.saveStats, (_e, key: unknown, summary: unknown) => (typeof key === 'string' ? statsStore.save(key, summary) : undefined))
  ipcMain.handle(IPC.getThumbs, (_e, keys: unknown) => thumbs.getMany(Array.isArray(keys) ? keys.map(String).slice(0, 50000) : []))
  ipcMain.handle(IPC.saveThumb, (_e, key: unknown, dataUrl: unknown) =>
    typeof key === 'string' && typeof dataUrl === 'string' ? thumbs.save(key, dataUrl) : undefined
  )
  // Images load straight from disk, only those on screen; a new version gets a new URL (`?v=`).
  protocol.handle(THUMB_SCHEME, async (request) => {
    const found = await thumbs.read(decodeURIComponent(new URL(request.url).pathname.slice(1)))
    if (!found) return new Response(null, { status: 404 })
    return new Response(found.bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': found.type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' } })
  })

  ipcMain.handle(IPC.cacheUsage, () => wrap(() => janitor.usage()))
  ipcMain.handle(IPC.clearCache, () => wrap(() => janitor.clear()))
  // Leftovers and the size limit are dealt with once the app has settled.
  setTimeout(() => void janitor.cleanStale().then(() => janitor.prune()), 15_000)

  const requireShared = (): SharedIndexService => {
    if (!session) throw new SourceError('unauthorized', 'Not signed in')
    return session.sharedIndex
  }
  ipcMain.handle(IPC.sharedIndexStatus, () => wrap(() => requireShared().status()))
  ipcMain.handle(IPC.sharedIndexImport, () => wrap(() => requireShared().importNow().then(() => requireShared().status())))
  ipcMain.handle(IPC.sharedIndexExport, () => wrap(() => requireShared().exportNow().then(() => requireShared().status())))
  setInterval(() => void session?.sharedIndex.check(), SHARED_INDEX_CHECK_MS)

  return {
    janitor,
    sharedIndexChanged: () => void session?.sharedIndex.check(),
    account: () => (session?.status.login ? { login: session.status.login, token: session.token } : undefined)
  }
}
