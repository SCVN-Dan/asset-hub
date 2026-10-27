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
  source: {
    listRepos: () => ipcRenderer.invoke(IPC.listRepos),
    listBranches: (repo) => ipcRenderer.invoke(IPC.listBranches, repo),
    listTree: (repo, branch) => ipcRenderer.invoke(IPC.listTree, repo, branch)
  }
}

contextBridge.exposeInMainWorld('api', api)
