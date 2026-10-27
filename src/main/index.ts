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

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = new SettingsStore(join(userData, 'settings.json'), {
    language: 'en',
    cacheDir: join(userData, 'cache'),
    excludedFolders: DEFAULT_EXCLUDED_FOLDERS
  })

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
