import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { createDefaultRegistry } from '@core/index'
import { AI_TOOL_NAMES, aiToolSpecs, type AiToolResult } from '@shared/aiTools'
import { IPC, type AiChatEvent, type AiStatus } from '@shared/ipc'
import { LANGUAGE_NAMES, type Language } from '@shared/settings'
import { CodexClient, LOCKED_THREAD, spawnCodex } from './codexClient'
import { findCodex, installCodex } from './codexInstaller'

/** What the assistant is told about itself and its limits. */
function instructions(language: Language): string {
  return [
    'You are the assistant inside Asset Hub, a desktop app where game artists and developers at Supercent browse Unity projects on GitHub',
    '(models, prefabs, VFX, textures, sprites, materials, audio, animations, fonts), preview them and export them as .unitypackage files.',
    `Answer in ${LANGUAGE_NAMES[language]} unless the user writes in another language.`,
    'You live in a small chat bubble in the corner of the app, like a pet: reply in one or two short sentences (under 40 words), friendly and to the point.',
    'No headings, tables or long lists; at most three short bullet points when a list is really needed.',
    'You cannot run commands, read or write files, or browse the web, and you never change anything on GitHub.',
    'Use the tools to act in the hub. search_assets shows its results in the hub itself, so do not list them back:',
    "name the best one or two and say the rest are on screen. Open an asset when the user wants to see it; use refs exactly as the tools return them.",
    'Add to the chest or a collection only when asked; exporting is done by the user with the Export button.',
    'Where to search: if the user names a repo ("in repo pizza", "trong luna_pizza"), search with repo set to that name — every branch of it, no question.',
    'If they say this branch, all branches or every repo, use where=branch, where=repo or where=all — no question. If an earlier message in the',
    'conversation already settled where, keep using it. Only when nothing tells you where, call offer_choices with "this branch" and',
    '"all branches" in their language (e.g. "Branch này", "Mọi branch") and other=true, and ask where in one line.',
    'Questions in general: ask only when the answer is truly unknown and changes what you do; then offer 2-4 choices instead of asking in words,',
    'at most once per request. If a tool says a name is ambiguous, offer the candidates as choices.',
    'Search keywords: file names are English words, often joined (FarmMachine, CuttingMachine). Unless the user gave a plain English file-name word,',
    'first call name_words for the same repo/scope and type, pick every word from that list that could mean what the user wants, and search them',
    'all at once separated by " | " (any matches), plus the plain English word for it, since joined names hide words from that list',
    '(NewXRayMachine lists as "ray", "machine"): "máy cắt lúa" → "cuttingmachine | harvester | farm machine | tractor"; "máy x-quang" → "xray | x ray | scanner".',
    'Words inside one alternative must all match, so keep each alternative to one idea. Search once like that; retry only if nothing comes up.',
    'If the user says a result is not what they meant, look at the other results (asset_info) or search again with different names, not the same ones.',
    'Type tabs: fbx (models), prefab, vfx (effects), texture, sprite, material, audio, animation, font. Search with short English keywords as in file names.'
  ].join(' ')
}

/**
 * The AI assistant's connection: Codex (installed by the app, pinned) running
 * `app-server` in a home of its own, signed in with the user's ChatGPT account
 * through the browser. No API key; the account's plan pays for it.
 */
/** Images sent with a chat message: data URLs of PNG, JPEG, WebP or GIF. */
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/
const MAX_IMAGES = 4
/** About 6 MB of image per picture (base64 text). */
const MAX_IMAGE_CHARS = 8_000_000

export function registerAiIpc(options: { toolsDir: string; codexHome: string }): void {
  const supported = process.platform === 'darwin' && process.arch === 'arm64'
  let running: Promise<{ client: CodexClient; stop(): void }> | undefined
  let status: AiStatus = { state: supported ? 'notInstalled' : 'unsupported' }
  let loginId: string | undefined
  /** The conversation in the chat panel: one Codex thread, and the turn being answered. */
  let chat: { threadId: string; turnId?: string } | undefined
  /** The hub's type tabs, for the search tool. */
  const assetTypes = createDefaultRegistry()
    .all()
    .filter((h) => !h.hidden)
    .map((h) => h.id)
  /** The thread's working folder: empty, and the sandbox is read-only anyway. */
  const chatDir = join(app.getPath('temp'), 'asset-hub-ai')

  const emit = (event: AiChatEvent) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.aiChatEvent, event)
  }

  const publish = (next: AiStatus): AiStatus => {
    status = next
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.aiStatus, status)
    return status
  }

  /** Tool calls waiting for the hub's answer, by call id. */
  const pendingTools = new Map<string, (result: AiToolResult) => void>()
  let toolSeq = 0
  /** Hands a tool call to the hub (it acts on what the user sees) and waits for its answer. */
  const callTool = (tool: string, args: unknown) =>
    new Promise<AiToolResult>((resolve) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return resolve({ ok: false, error: 'The Asset Hub window is closed' })
      const callId = String(++toolSeq)
      const finish = (result: AiToolResult) => {
        clearTimeout(timer)
        pendingTools.delete(callId)
        resolve(result)
      }
      const timer = setTimeout(() => finish({ ok: false, error: 'The hub did not answer in time' }), 25_000)
      pendingTools.set(callId, finish)
      emit({ type: 'tool', tool })
      win.webContents.send(IPC.aiToolCall, { callId, tool, args })
    })
  ipcMain.handle(IPC.aiToolResult, (_event, callId: unknown, result: unknown) => {
    const r = result as AiToolResult | undefined
    pendingTools.get(String(callId))?.(r && typeof r === 'object' && 'ok' in r ? r : { ok: false, error: 'Bad answer from the hub' })
  })

  /**
   * Codex asks the app for two things: running one of Asset Hub's tools, answered by the hub, and
   * approvals for commands, file edits or permissions, always declined. Anything else is refused.
   */
  const handleServerRequest = async (method: string, params: unknown): Promise<unknown> => {
    if (method === 'item/tool/call') {
      const { tool, arguments: args } = params as { tool: string; arguments: unknown }
      const result: AiToolResult = (AI_TOOL_NAMES as readonly string[]).includes(tool) ? await callTool(tool, args) : { ok: false, error: `Unknown tool ${tool}` }
      return { success: result.ok, contentItems: [{ type: 'inputText', text: JSON.stringify(result.ok ? result.data : { error: result.error }) }] }
    }
    if (/approval/i.test(method)) return { decision: 'decline' }
    throw new Error(`${method} is not supported by Asset Hub`)
  }

  const start = (): Promise<CodexClient> => {
    running ??= (async () => {
      const binary = await findCodex(options.toolsDir)
      if (!binary) throw new Error('Codex is not installed')
      await mkdir(options.codexHome, { recursive: true })
      const codex = spawnCodex(binary, options.codexHome, handleServerRequest)
      void codex.exited.then((reason) => {
        running = undefined
        if (status.state === 'connecting') publish({ state: 'error', error: reason })
        // Its threads ended with it.
        if (chat?.turnId) emit({ type: 'done', status: 'failed', error: reason })
        chat = undefined
      })
      await codex.client.request('initialize', {
        clientInfo: { name: 'asset_hub', title: 'Asset Hub', version: app.getVersion() },
        capabilities: { experimentalApi: true, requestAttestation: false }
      })
      codex.client.notify('initialized')
      codex.client.onNotification((method, params) => {
        if (chat && (params as { threadId?: string })?.threadId === chat.threadId) return onChat(method, params)
        if (method !== 'account/login/completed') return
        const done = params as { loginId: string | null; success: boolean; error: string | null }
        if (done.loginId && loginId && done.loginId !== loginId) return
        loginId = undefined
        if (done.success) void read()
        else publish({ state: 'signedOut', ...(done.error ? { error: done.error } : {}) })
      })
      return codex
    })()
    running.catch(() => (running = undefined))
    return running.then((r) => r.client)
  }

  /** Streamed events of the chat's thread, passed on to the panel. */
  const onChat = (method: string, params: unknown) => {
    if (method === 'item/agentMessage/delta') {
      const { itemId, delta } = params as { itemId: string; delta: string }
      emit({ type: 'delta', itemId, text: delta })
    } else if (method === 'turn/completed') {
      const { turn } = params as { turn: { status: string; error: { message: string } | null } }
      if (chat) chat.turnId = undefined
      emit({ type: 'done', status: turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed', ...(turn.error ? { error: turn.error.message } : {}) })
    } else if (method === 'error') {
      const { error, willRetry } = params as { error: { message: string }; willRetry?: boolean }
      if (!willRetry) emit({ type: 'error', message: error.message })
    }
  }

  /** Where things stand: installed or not, and the ChatGPT account Codex is signed in with. */
  const read = async (): Promise<AiStatus> => {
    if (!supported) return publish({ state: 'unsupported' })
    if (status.state === 'installing') return status
    try {
      if (!(await findCodex(options.toolsDir))) return publish({ state: 'notInstalled' })
      const client = await start()
      const { account } = await client.request<{ account: { type: string; email?: string | null; planType?: string } | null }>('account/read', { refreshToken: false })
      if (account?.type === 'chatgpt') return publish({ state: 'connected', ...(account.email ? { email: account.email } : {}), ...(account.planType ? { plan: account.planType } : {}) })
      return publish(loginId ? { state: 'connecting' } : { state: 'signedOut' })
    } catch (err) {
      return publish({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  ipcMain.handle(IPC.aiGetStatus, () => read())

  ipcMain.handle(IPC.aiInstall, async (event) => {
    if (!supported) return read()
    publish({ state: 'installing' })
    try {
      await installCodex(options.toolsDir, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.aiInstallProgress, progress)
      })
      status = { state: 'notInstalled' }
      return read()
    } catch (err) {
      return publish({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  })

  // Opens ChatGPT's sign-in page in the browser; `account/login/completed` reports back.
  ipcMain.handle(IPC.aiConnect, async () => {
    try {
      const client = await start()
      const login = await client.request<{ loginId?: string; authUrl?: string }>('account/login/start', { type: 'chatgpt' })
      if (!login.authUrl?.startsWith('https://')) throw new Error('ChatGPT did not return a sign-in page')
      loginId = login.loginId
      await shell.openExternal(login.authUrl)
      return publish({ state: 'connecting' })
    } catch (err) {
      return publish({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  })

  ipcMain.handle(IPC.aiCancelConnect, async () => {
    const id = loginId
    loginId = undefined
    if (id) await start().then((c) => c.request('account/login/cancel', { loginId: id })).catch(() => {})
    return read()
  })

  ipcMain.handle(IPC.aiDisconnect, async () => {
    await start().then((c) => c.request('account/logout')).catch(() => {})
    return read()
  })

  ipcMain.handle(IPC.aiChatSend, async (_event, text: unknown, language: unknown, images: unknown): Promise<{ ok: true } | { ok: false; message: string }> => {
    try {
      const message = String(text ?? '').trim()
      // Pictures the user attached (screenshots, references): data URLs of common image types, a few and not too big.
      const pictures = (Array.isArray(images) ? images : []).filter((u): u is string => typeof u === 'string' && IMAGE_URL.test(u) && u.length <= MAX_IMAGE_CHARS).slice(0, MAX_IMAGES)
      if (!message && !pictures.length) return { ok: true }
      if ((await read()).state !== 'connected') throw new Error('ChatGPT is not connected')
      const client = await start()
      if (!chat) {
        await mkdir(chatDir, { recursive: true })
        const started = await client.request<{ thread: { id: string } }>('thread/start', {
          ...LOCKED_THREAD,
          cwd: chatDir,
          developerInstructions: instructions(typeof language === 'string' && language in LANGUAGE_NAMES ? (language as Language) : 'en'),
          dynamicTools: aiToolSpecs(assetTypes)
        })
        chat = { threadId: started.thread.id }
      }
      const turn = await client.request<{ turn: { id: string } }>('turn/start', {
        threadId: chat.threadId,
        input: [{ type: 'text', text: message || '(See the attached image.)', text_elements: [] }, ...pictures.map((url) => ({ type: 'image', url }))],
        // Chat wants quick answers more than deep reasoning.
        effort: 'low'
      })
      chat.turnId = turn.turn.id
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  // 👎 on an answer: the conversation and the tools it used, as a file to add to the pet's test cases.
  ipcMain.handle(IPC.aiFeedback, async (_event, report: unknown) => {
    const r = report as { messages?: unknown; tools?: unknown }
    const messages = Array.isArray(r?.messages) ? r.messages.slice(-20).map((m) => ({ role: String((m as { role?: unknown }).role), text: String((m as { text?: unknown }).text).slice(0, 4000) })) : []
    const dir = join(app.getPath('userData'), 'ai-feedback')
    await mkdir(dir, { recursive: true })
    const at = new Date().toISOString()
    await writeFile(join(dir, `${at.replace(/[:.]/g, '-')}.json`), JSON.stringify({ at, version: app.getVersion(), messages, tools: Array.isArray(r?.tools) ? r.tools.slice(-30).map(String) : [] }, null, 2))
  })

  ipcMain.handle(IPC.aiChatStop, async () => {
    const current = chat
    if (current?.turnId) await start().then((c) => c.request('turn/interrupt', { threadId: current.threadId, turnId: current.turnId })).catch(() => {})
  })

  // A new conversation: the next message starts a new thread (threads are ephemeral, nothing to clean up).
  ipcMain.handle(IPC.aiChatReset, async () => {
    const current = chat
    chat = undefined
    if (current?.turnId) await start().then((c) => c.request('turn/interrupt', { threadId: current.threadId, turnId: current.turnId })).catch(() => {})
  })

  app.on('before-quit', () => void running?.then((r) => r.stop()).catch(() => {}))
}

