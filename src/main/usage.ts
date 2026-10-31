import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow, ipcMain, net, powerMonitor } from 'electron'
import { IPC } from '@shared/ipc'
import {
  feedbackIssue,
  isWorthSending,
  newSession,
  noteEvent,
  noteIpc,
  sanitizeFeedback,
  usageComment,
  USAGE_TITLE_PREFIX,
  type FeedbackReport,
  type FeedbackResult,
  type UsageEvent,
  type UsageSession
} from '@shared/usage'
import { FeedbackRepo } from './feedbackRepo'
import { feedbackRepo } from '../../package.json'

/** Active time is counted in steps of this, while the window is focused and the user not away. */
const TICK_MS = 60_000
const AWAY_S = 5 * 60
/** A session left open this long is sent and a new one started. */
const MAX_SESSION_MS = 8 * 3600_000
/** Unsent sessions kept on disk at most (oldest dropped). */
const MAX_PENDING = 50

interface Options {
  dir: string
  account(): { login: string; token: string } | undefined
  language(): string
  /** The "Send usage statistics" setting; feedback is sent either way. */
  enabled(): boolean
}

/**
 * Must be called before other IPC handlers are registered: it wraps
 * `ipcMain.handle` to count what requests do (see shared/usage `noteIpc`).
 */
export function registerUsage(options: Options): void {
  const sessionsDir = join(options.dir, 'sessions')
  const outboxDir = join(options.dir, 'outbox')
  const issueFile = join(options.dir, 'issues.json')
  mkdirSync(sessionsDir, { recursive: true })
  mkdirSync(outboxDir, { recursive: true })
  const os = `${process.platform === 'darwin' ? 'macOS' : process.platform} ${process.getSystemVersion()}`
  const start = () => newSession(randomUUID(), new Date(), { version: app.getVersion(), os, language: options.language() })
  let current: UsageSession = start()
  let dirty = true

  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, ...args) => {
      const result = await listener(event, ...args)
      try {
        noteIpc(current, channel, args, result)
        dirty = true
      } catch {
        // counting never gets in the way of the request
      }
      return result
    })

  const save = async () => {
    current.end = new Date().toISOString()
    current.login ??= options.account()?.login
    current.language = options.language()
    dirty = false
    if (options.enabled()) await writeFile(join(sessionsDir, `${current.id}.json`), JSON.stringify(current)).catch(() => {})
  }

  const repoFor = () => {
    const account = options.account()
    return account && feedbackRepo ? { login: account.login, repo: new FeedbackRepo(feedbackRepo, account.token, (url, init) => net.fetch(url, init)) } : undefined
  }

  /** The user's `usage:` issue, remembered after the first lookup. */
  const usageIssue = async (repo: FeedbackRepo, login: string): Promise<number> => {
    const key = `${repo.repo}:${login}`
    const known = (JSON.parse(await readFile(issueFile, 'utf8').catch(() => '{}')) as Record<string, number>)
    if (known[key]) return known[key]
    const title = USAGE_TITLE_PREFIX + login
    const number =
      (await repo.findIssue(login, title)) ??
      (await repo.createIssue(title, `Usage of Asset Hub by @${login}, one comment per session. Written by the app; read with \`node scripts/usage-report.mjs\`.`)).number
    await writeFile(issueFile, JSON.stringify({ ...known, [key]: number }))
    return number
  }

  let flushing: Promise<void> | undefined
  /** Sends finished sessions (on quit, this one too) and queued feedback; whatever fails waits for the next time. */
  const flush = (withCurrent = false) =>
    (flushing ??= (async () => {
      const target = repoFor()
      if (!target) return
      for (const file of (await readdir(outboxDir).catch(() => [])).filter((f) => f.endsWith('.json'))) {
        try {
          const { report } = JSON.parse(await readFile(join(outboxDir, file), 'utf8')) as { report: FeedbackReport }
          await sendFeedback(target.repo, target.login, report)
          await rm(join(outboxDir, file), { force: true })
        } catch {
          break
        }
      }
      const files = (await readdir(sessionsDir).catch(() => [])).filter((f) => f.endsWith('.json') && (withCurrent || f !== `${current.id}.json`)).sort()
      for (const file of files.slice(0, Math.max(0, files.length - MAX_PENDING))) await rm(join(sessionsDir, file), { force: true })
      for (const file of files.slice(-MAX_PENDING)) {
        const path = join(sessionsDir, file)
        try {
          const session = JSON.parse(await readFile(path, 'utf8')) as UsageSession
          // Someone else's session on a shared Mac stays for them.
          if (session.login && session.login !== target.login) continue
          session.login ??= target.login
          if (options.enabled() && isWorthSending(session)) await target.repo.comment(await usageIssue(target.repo, target.login), usageComment(session))
          await rm(path, { force: true })
        } catch {
          break
        }
      }
    })().finally(() => (flushing = undefined)))

  const sendFeedback = async (repo: FeedbackRepo, login: string, report: FeedbackReport) => {
    const { title, body } = feedbackIssue(report, { login, version: app.getVersion(), os, language: options.language() })
    return repo.createIssue(title, body)
  }

  setInterval(() => {
    const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    if (focused && powerMonitor.getSystemIdleTime() < AWAY_S) {
      current.activeMs += TICK_MS
      dirty = true
    }
    if (Date.now() - Date.parse(current.start) > MAX_SESSION_MS) {
      void save().then(() => {
        current = start()
        void flush()
      })
    } else if (dirty) void save()
  }, TICK_MS)
  // Last time's sessions go out once sign-in has had time to finish; then now and then.
  setTimeout(() => void flush(), 20_000)
  setInterval(() => void flush(), 3600_000)

  // On quit: this session is saved and sent, waiting a few seconds at most.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    const done = save().then(() => {
      if (options.enabled()) return flushing ? flushing.then(() => flush(true)) : flush(true)
    })
    void Promise.race([done, new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit())
  })

  ipcMain.on(IPC.usageTrack, (_event, raw: unknown) => {
    noteEvent(current, raw as UsageEvent)
    dirty = true
  })

  ipcMain.handle(IPC.feedbackSend, async (_event, raw: unknown): Promise<FeedbackResult> => {
    const report = sanitizeFeedback(raw)
    if (!report) return { sent: false }
    noteEvent(current, { kind: 'feedback' })
    const target = repoFor()
    try {
      if (!target) throw new Error('not signed in')
      return { sent: true, url: (await sendFeedback(target.repo, target.login, report)).html_url }
    } catch {
      await mkdir(outboxDir, { recursive: true })
      await writeFile(join(outboxDir, `${Date.now()}.json`), JSON.stringify({ report }))
      return { sent: false }
    }
  })
}
