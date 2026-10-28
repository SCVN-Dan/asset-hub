import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { DEFAULT_EXCLUDED_FOLDERS } from '@shared/settings'
import { registerGitHubIpc } from './github'
import { SettingsStore } from './settingsStore'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Asset Hub',
    backgroundColor: '#0F1115',
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

// One window per machine: a second launch focuses the first (two would fight over the cache).
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win?.isMinimized()) win.restore()
  win?.focus()
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
