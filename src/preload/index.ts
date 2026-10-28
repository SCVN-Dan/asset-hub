import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AssetHubApi } from '@shared/ipc'

const api: AssetHubApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  auth: {
    status: () => ipcRenderer.invoke(IPC.authStatus),
    signInWithToken: (token) => ipcRenderer.invoke(IPC.signInWithToken, token),
    signInWithGh: () => ipcRenderer.invoke(IPC.signInWithGh),
    ghWebLogin: () => ipcRenderer.invoke(IPC.ghWebLogin),
    cancelGhWebLogin: () => ipcRenderer.invoke(IPC.cancelGhWebLogin),
    onGhLoginPrompt: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, prompt: { code: string; url: string }) => listener(prompt)
      ipcRenderer.on(IPC.ghLoginPrompt, handler)
      return () => ipcRenderer.removeListener(IPC.ghLoginPrompt, handler)
    },
    signOut: () => ipcRenderer.invoke(IPC.signOut)
  },
  tools: {
    installGh: () => ipcRenderer.invoke(IPC.installGh),
    onInstallProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC.installProgress, handler)
      return () => ipcRenderer.removeListener(IPC.installProgress, handler)
    }
  },
  source: {
    listRepos: () => ipcRenderer.invoke(IPC.listRepos),
    listBranches: (repo) => ipcRenderer.invoke(IPC.listBranches, repo),
    listTree: (repo, branch) => ipcRenderer.invoke(IPC.listTree, repo, branch)
  },
  assets: {
    resolve: (repo, branch, path, root) => ipcRenderer.invoke(IPC.resolveAsset, repo, branch, path, root),
    readFile: (repo, branch, path) => ipcRenderer.invoke(IPC.readFile, repo, branch, path),
    findByNames: (repo, branch, names, nearPath, root) => ipcRenderer.invoke(IPC.findByNames, repo, branch, names, nearPath, root),
    onIndexProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { done: number; total: number }) => listener(progress)
      ipcRenderer.on(IPC.indexProgress, handler)
      return () => ipcRenderer.removeListener(IPC.indexProgress, handler)
    },
    findPrefabMaterials: (repo, branch, path, root, scope, excludedFolders) =>
      ipcRenderer.invoke(IPC.findPrefabMaterials, repo, branch, path, root, scope, excludedFolders),
    onPrefabProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { done: number; total: number }) => listener(progress)
      ipcRenderer.on(IPC.prefabProgress, handler)
      return () => ipcRenderer.removeListener(IPC.prefabProgress, handler)
    }
  },
  thumbs: {
    get: (keys) => ipcRenderer.invoke(IPC.getThumbs, keys),
    save: (key, dataUrl) => ipcRenderer.invoke(IPC.saveThumb, key, dataUrl)
  },
  exporter: {
    unityPackage: (request) => ipcRenderer.invoke(IPC.exportPackage, request),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC.exportProgress, handler)
      return () => ipcRenderer.removeListener(IPC.exportProgress, handler)
    },
    showInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, path)
  }
}

contextBridge.exposeInMainWorld('api', api)
