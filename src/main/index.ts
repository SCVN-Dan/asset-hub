import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'path'
import { IPC } from '@shared/ipc'
import { DEFAULT_EXCLUDED_FOLDERS } from '@shared/settings'
import { registerGitHubIpc } from './github'
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
app.setPath('userData', join(app.getPath('appData'), 'asset-hub'))

// Chromium keeps its own HTTP cache of every GitHub download, duplicating the blob cache in
// AssetHubCache (it grew past 300 MB). A small one still lets API calls revalidate with ETags.
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024))

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

  ipcMain.handle(IPC.getSettings, () => settings.get())
  ipcMain.handle(IPC.setSettings, (_event, patch: unknown) => settings.set(patch))
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
  ipcMain.handle(IPC.openExternal, async (_event, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url)
  })

  registerGitHubIpc({ authFile: join(userData, 'auth.json'), cacheDir: () => settings.get().cacheDir, toolsDir: join(userData, 'tools') })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
