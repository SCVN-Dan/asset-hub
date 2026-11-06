import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AssetHubApi } from '@shared/ipc'
import type { FactKind } from '@core/index'

const api: AssetHubApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  isUnityProject: (path) => ipcRenderer.invoke(IPC.isUnityProject, path),
  takeDeepLink: () => ipcRenderer.invoke(IPC.takeDeepLink),
  onDeepLink: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(IPC.deepLink, handler)
    return () => ipcRenderer.removeListener(IPC.deepLink, handler)
  },
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
    signOut: (options) => ipcRenderer.invoke(IPC.signOut, options)
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
    listTree: (repo, branch) => ipcRenderer.invoke(IPC.listTree, repo, branch),
    watchCheck: (repo, branch, seen) => ipcRenderer.invoke(IPC.watchCheck, repo, branch, seen)
  },
  assets: {
    resolve: (repo, branch, path, root, mode, background) => ipcRenderer.invoke(IPC.resolveAsset, repo, branch, path, root, mode, background),
    readFile: (repo, branch, path, background) => ipcRenderer.invoke(IPC.readFile, repo, branch, path, background),
    saveFile: (repo, branch, path) => ipcRenderer.invoke(IPC.saveFile, repo, branch, path),
    modelBundle: (repo, branch, path, materials, mode, glb) => ipcRenderer.invoke(IPC.modelBundle, repo, branch, path, materials, mode, glb),
    blenderInstalled: () => ipcRenderer.invoke(IPC.findBlender),
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
    },
    knownAssets: (repo, branch, kind) => ipcRenderer.invoke(IPC.knownAssets, repo, branch, kind),
    onKnownProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, kind: FactKind, progress: { done: number; total: number; found?: string[] }) => listener(kind, progress)
      ipcRenderer.on(IPC.knownProgress, handler)
      return () => ipcRenderer.removeListener(IPC.knownProgress, handler)
    }
  },
  catalog: {
    scan: (repo, current) => ipcRenderer.invoke(IPC.catalogScan, repo, current),
    pause: () => ipcRenderer.invoke(IPC.catalogPause),
    resume: () => ipcRenderer.invoke(IPC.catalogResume),
    status: () => ipcRenderer.invoke(IPC.catalogStatus),
    list: (repo, excludedFolders, filter) => ipcRenderer.invoke(IPC.catalogList, repo, excludedFolders, filter),
    whereIs: (sha) => ipcRenderer.invoke(IPC.catalogWhere, sha),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on(IPC.catalogProgress, handler)
      return () => ipcRenderer.removeListener(IPC.catalogProgress, handler)
    }
  },
  thumbs: {
    get: (keys) => ipcRenderer.invoke(IPC.getThumbs, keys),
    save: (key, dataUrl) => ipcRenderer.invoke(IPC.saveThumb, key, dataUrl)
  },
  sharedIndex: {
    status: () => ipcRenderer.invoke(IPC.sharedIndexStatus),
    import: () => ipcRenderer.invoke(IPC.sharedIndexImport),
    export: () => ipcRenderer.invoke(IPC.sharedIndexExport),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on(IPC.sharedIndexProgress, handler)
      return () => ipcRenderer.removeListener(IPC.sharedIndexProgress, handler)
    }
  },
  cache: {
    usage: () => ipcRenderer.invoke(IPC.cacheUsage),
    clear: () => ipcRenderer.invoke(IPC.clearCache)
  },
  stats: {
    get: (keys) => ipcRenderer.invoke(IPC.getStats, keys),
    save: (key, summary) => ipcRenderer.invoke(IPC.saveStats, key, summary)
  },
  exporter: {
    unityPackage: (request) => ipcRenderer.invoke(IPC.exportPackage, request),
    unityEditors: () => ipcRenderer.invoke(IPC.unityEditors),
    importToUnity: (request, pid) => ipcRenderer.invoke(IPC.importToUnity, request, pid),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC.exportProgress, handler)
      return () => ipcRenderer.removeListener(IPC.exportProgress, handler)
    },
    showInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, path)
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiGetStatus),
    install: () => ipcRenderer.invoke(IPC.aiInstall),
    onInstallProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC.aiInstallProgress, handler)
      return () => ipcRenderer.removeListener(IPC.aiInstallProgress, handler)
    },
    connect: () => ipcRenderer.invoke(IPC.aiConnect),
    cancelConnect: () => ipcRenderer.invoke(IPC.aiCancelConnect),
    disconnect: () => ipcRenderer.invoke(IPC.aiDisconnect),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on(IPC.aiStatus, handler)
      return () => ipcRenderer.removeListener(IPC.aiStatus, handler)
    },
    chatSend: (text, language, images) => ipcRenderer.invoke(IPC.aiChatSend, text, language, images),
    chatStop: () => ipcRenderer.invoke(IPC.aiChatStop),
    chatReset: () => ipcRenderer.invoke(IPC.aiChatReset),
    onChat: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event)
      ipcRenderer.on(IPC.aiChatEvent, handler)
      return () => ipcRenderer.removeListener(IPC.aiChatEvent, handler)
    },
    onToolCall: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, call: Parameters<typeof listener>[0]) => listener(call)
      ipcRenderer.on(IPC.aiToolCall, handler)
      return () => ipcRenderer.removeListener(IPC.aiToolCall, handler)
    },
    toolResult: (callId, result) => ipcRenderer.invoke(IPC.aiToolResult, callId, result),
    feedback: (report) => ipcRenderer.invoke(IPC.aiFeedback, report)
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: (version) => ipcRenderer.invoke(IPC.updateInstall, version),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC.updateProgress, handler)
      return () => ipcRenderer.removeListener(IPC.updateProgress, handler)
    }
  },
  usage: {
    track: (event) => ipcRenderer.send(IPC.usageTrack, event)
  },
  feedback: {
    send: (report) => ipcRenderer.invoke(IPC.feedbackSend, report)
  }
}

contextBridge.exposeInMainWorld('api', api)
