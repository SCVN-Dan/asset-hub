import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join, resolve } from 'path'
import { IPC, type InstallProgress } from '@shared/ipc'
import { DEFAULT_CACHE_LIMIT_GB, DEFAULT_EXCLUDED_FOLDERS } from '@shared/settings'
import { registerGitHubIpc } from './github'
import { checkForUpdate, installUpdate } from './updater'
import { registerAiIpc } from './ai'
import { registerUsage } from './usage'
import { THUMB_SCHEME } from './caches'
import { SettingsStore } from './settingsStore'
import { isUnityProject } from './targetProject'
import { LINK_SCHEME } from '@shared/deeplink'

/** The chest icon in build/; a packaged app gets it from its bundle instead. */
const DEV_ICON = join(__dirname, '../../build/icon.png')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Asset Hub',
    backgroundColor: '#0E131B',
    ...(app.isPackaged ? {} : { icon: DEV_ICON }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // The window only ever shows the app itself: a dropped file or a stray link must not replace it.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // Never open new Electron windows; send https links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// "Asset Hub" in menus and the Dock, while the data folder keeps the package name
// ("asset-hub") so settings, sign-in and the cache stay where they are.
app.setName('Asset Hub')
// ASSETHUB_USER_DATA runs a second, separate copy (testing a build beside the installed app).
app.setPath('userData', process.env.ASSETHUB_USER_DATA || join(app.getPath('appData'), 'asset-hub'))

// Chromium keeps its own HTTP cache of every GitHub download, duplicating the blob cache in
// AssetHubCache (it grew past 300 MB). A small one still lets API calls revalidate with ETags.
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024))

// Thumbnails are served from the cache folder on their own scheme; `corsEnabled` lets the page
// draw them on a canvas (exported package previews) without tainting it.
protocol.registerSchemesAsPrivileged([{ scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

/** The cache folder's size limit and the shared index, once set up. */
let github: ReturnType<typeof registerGitHubIpc> | undefined

// assethub:// links open an asset in the app. Under `npm run dev` the protocol points at the dev
// Electron with the app's path; macOS only hands links to a packaged app (Phase 10).
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
else app.setAsDefaultProtocolClient(LINK_SCHEME)

/**
 * The latest link, kept until the asset browser takes it: a link can arrive before the
 * window exists (it launched the app) or while the user is still signing in.
 */
let pendingLink: string | undefined
const linkIn = (argv: readonly string[]) => argv.find((a) => a.startsWith(`${LINK_SCHEME}://`))
function deliverLink(url: string) {
  pendingLink = url
  // A nudge: a browser that is open takes it at once.
  BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.deepLink)
}
pendingLink = linkIn(process.argv)
// macOS hands links over this way, also the one that launched the app.
app.on('open-url', (event, url) => {
  event.preventDefault()
  deliverLink(url)
})

// One window per machine: a second launch focuses the first (two would fight over the cache).
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win?.isMinimized()) win.restore()
  win?.focus()
  // Windows and Linux pass a clicked link as an argument of the second launch.
  const url = linkIn(argv)
  if (url) deliverLink(url)
})

/** ASSETHUB_TRACE=1 logs how long each IPC request takes, to find what holds up loading. */
if (process.env.ASSETHUB_TRACE) {
  const handle = ipcMain.handle.bind(ipcMain)
  const t0 = Date.now()
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, ...args) => {
      const start = Date.now()
      try {
        return await listener(event, ...args)
      } finally {
        console.log(`[ipc] +${((start - t0) / 1000).toFixed(1)}s ${channel} ${JSON.stringify(args).slice(0, 90)} ${Date.now() - start}ms`)
      }
    })
}

app.whenReady().then(() => {
  if (!app.isPackaged) app.dock?.setIcon(DEV_ICON)
  const userData = app.getPath('userData')
  // Not "cache": on case-insensitive disks that is Chromium's own "Cache" folder,
  // which Chromium cleans up on launch — deleting thumbnails and downloads.
  const cacheDir = join(userData, 'AssetHubCache')
  const settings = new SettingsStore(join(userData, 'settings.json'), {
    language: 'en',
    cacheDir,
    excludedFolders: DEFAULT_EXCLUDED_FOLDERS
  })
  if (settings.get().cacheDir.toLowerCase() === join(userData, 'cache').toLowerCase()) settings.set({ cacheDir })
  // First: it counts what the IPC handlers registered after it do.
  registerUsage({ dir: join(userData, 'usage'), account: () => github?.account(), language: () => settings.get().language, enabled: () => settings.get().usageStats !== false })

  ipcMain.handle(IPC.getSettings, () => settings.get())
  ipcMain.handle(IPC.setSettings, (_event, patch: unknown) => {
    const next = settings.set(patch)
    // A lower limit applies right away; a new shared folder is read at once.
    if (patch && typeof patch === 'object' && 'cacheLimitGB' in patch) void github?.janitor.prune()
    if (patch && typeof patch === 'object' && 'sharedIndexDir' in patch) github?.sharedIndexChanged()
    return next
  })
  ipcMain.handle(IPC.chooseFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  // The renderer asks once it can open things: a link that launched the app is waiting here.
  ipcMain.handle(IPC.takeDeepLink, () => {
    const url = pendingLink
    pendingLink = undefined
    return url ?? null
  })
  ipcMain.handle(IPC.isUnityProject, (_event, path: unknown) => (typeof path === 'string' && path ? isUnityProject(path) : false))
  // Codex keeps its ChatGPT sign-in and settings here, apart from any Codex the user runs themselves.
  registerAiIpc({ toolsDir: join(userData, 'tools'), codexHome: join(userData, 'codex') })
  ipcMain.handle(IPC.updateCheck, () => checkForUpdate().catch(() => null))
  // One install at a time, whether the app started it at launch or the user pressed the button.
  const sendProgress = (progress: InstallProgress) =>
    BrowserWindow.getAllWindows().forEach((w) => !w.webContents.isDestroyed() && w.webContents.send(IPC.updateProgress, progress))
  let installing: Promise<{ ok: true } | { ok: false; message: string }> | undefined
  const install = (version: string) =>
    (installing ??= installUpdate(version, sendProgress).then(
      () => ({ ok: true as const }),
      (err: unknown) => {
        installing = undefined
        return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
      }
    ))
  ipcMain.handle(IPC.updateInstall, (_event, version: unknown) => install(String(version)))
  // Updates itself at launch: a newer release is downloaded, checked and swapped in, then the app opens again
  // (about 1 MB on the same Electron). Copies run beside the installed app (ASSETHUB_USER_DATA) do not,
  // unless ASSETHUB_AUTO_UPDATE is set (to test updating).
  if (!process.env.ASSETHUB_USER_DATA || process.env.ASSETHUB_AUTO_UPDATE)
    void checkForUpdate()
      .then(async (info) => {
        if (!info.latest || !info.canInstall) return
        const result = await install(info.latest)
        if (!result.ok) sendProgress({ stage: 'failed', message: result.message })
      })
      .catch(() => undefined)
  ipcMain.handle(IPC.openExternal, async (_event, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url)
  })

  github = registerGitHubIpc({
    authFile: join(userData, 'auth.json'),
    cacheDir: () => settings.get().cacheDir,
    cacheLimit: () => (settings.get().cacheLimitGB ?? DEFAULT_CACHE_LIMIT_GB) * 1024 ** 3,
    sharedIndexDir: () => settings.get().sharedIndexDir,
    toolsDir: join(userData, 'tools')
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
