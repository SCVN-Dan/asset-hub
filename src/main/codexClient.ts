import { spawn } from 'child_process'
import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

/** A request from Codex to the app (an approval, a tool call…); its answer, or a throw for an error reply. */
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>

/**
 * JSON-RPC with `codex app-server` over stdio: one JSON object per line, no
 * "jsonrpc" field. Our requests get responses by id; Codex sends
 * notifications (streamed events) and its own requests, answered by `handle`.
 */
export class CodexClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(err: Error): void }>()
  private readonly listeners = new Set<(method: string, params: unknown) => void>()
  private closed?: Error

  constructor(
    private readonly io: { stdin: Writable; stdout: Readable },
    private readonly handle: ServerRequestHandler
  ) {
    createInterface({ input: io.stdout }).on('line', (line) => this.receive(line))
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.send({ method, id, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed) this.send({ method, ...(params === undefined ? {} : { params }) })
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The process ended: every waiting request fails with `reason`. */
  close(reason: Error): void {
    if (this.closed) return
    this.closed = reason
    for (const p of this.pending.values()) p.reject(reason)
    this.pending.clear()
  }

  private send(message: object): void {
    this.io.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string): void {
    let msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.method && msg.id !== undefined) {
      const id = msg.id
      this.handle(msg.method, msg.params).then(
        (result) => this.send({ id, result }),
        (err: unknown) => this.send({ id, error: { code: -32000, message: err instanceof Error ? err.message : String(err) } })
      )
    } else if (msg.method) {
      for (const l of this.listeners) l(msg.method, msg.params)
    } else if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) p?.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      else p?.resolve(msg.result)
    }
  }
}

/**
 * Codex features the assistant must not have: shell and terminals, ChatGPT
 * apps/connectors, browser and computer use, plugins and hooks, image tools,
 * goals, sleep. Left on: code mode, through which the model calls Asset Hub's
 * own tools — it has no file system, `require`, `import` or `fetch`. Tried on
 * 0.165.0: asked to read ~/.zshrc, run `ls`, write a file or fetch a page, every
 * attempt failed; file edits also hit the read-only sandbox and the "never"
 * approval policy (threads are started that way).
 */
export const LOCKED_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'in_app_local_automation',
  'plugins', 'remote_plugin', 'hooks', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'workspace_dependencies',
  'multi_agent', 'image_generation', 'view_image', 'goals', 'sleep_tool'
]

/** Thread settings every assistant conversation uses: nothing written, nothing asked of the user, an empty folder. */
export const LOCKED_THREAD = { sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true } as const

/** Starts `codex app-server` with its own home (sign-in, config, history apart from the user's own Codex). */
export function spawnCodex(binary: string, codexHome: string, handle: ServerRequestHandler): { client: CodexClient; stop(): void; exited: Promise<string> } {
  const args = ['app-server', ...LOCKED_FEATURES.flatMap((f) => ['--disable', f]), '-c', 'web_search="disabled"']
  const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: 'error' } })
  const client = new CodexClient({ stdin: child.stdin, stdout: child.stdout }, handle)
  // The last lines of its log, to explain an unexpected exit.
  let tail = ''
  child.stderr.on('data', (d: Buffer) => (tail = (tail + d.toString()).slice(-2000)))
  const exited = new Promise<string>((resolve) =>
    child.on('exit', (code, signal) => {
      const reason = `Codex stopped (${signal ?? `exit ${code}`})${tail.trim() ? `: ${tail.trim().split('\n').pop()}` : ''}`
      client.close(new Error(reason))
      resolve(reason)
    })
  )
  child.stdin.on('error', () => {})
  return { client, stop: () => child.kill(), exited }
}
