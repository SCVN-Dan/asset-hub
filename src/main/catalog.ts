import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { groupCatalog, planScan, RepoCatalog, SourceError, whereIs, type CatalogAsset, type CatalogLocation, type RepoRef, type ScanTask, type TreeEntry } from '@core/index'
import type { GitHubAssetSource } from '@core/github/source'
import type { CatalogStatus, IpcError } from '@shared/ipc'
import { writeAtomic } from './caches'

/** Branch lists older than this are read again before a scan. */
const REFRESH_MS = 10 * 60_000
const SCAN_CONCURRENCY = 6
const HEADS_CONCURRENCY = 4
const SAVE_DELAY_MS = 2000

const fileName = (repo: string) => `${repo.replace('/', '__').replace(/[^A-Za-z0-9._-]/g, '_')}.json`

/**
 * Background index of the asset files on every branch of the repos the user
 * asked about. Only names, paths and blob SHAs are kept (no file contents),
 * one JSON file per repo; branches whose commit did not change are skipped.
 */
export class CatalogService {
  private readonly catalogs = new Map<string, Promise<RepoCatalog>>()
  private readonly saveTimers = new Map<string, NodeJS.Timeout>()
  private queue: ScanTask[] = []
  private worker?: Promise<void>
  private resumeTimer?: NodeJS.Timeout
  private stopped = false
  private state: CatalogStatus = { state: 'idle', done: 0, total: 0 }
  private lastEmit = 0
  /** Bumped on every change, so grouped results can be reused until something new is indexed. */
  private version = 0
  private listed?: { key: string; version: number; result: Promise<CatalogAsset[]> }
  private emitTimer?: NodeJS.Timeout

  constructor(
    private readonly source: GitHubAssetSource,
    private readonly dir: () => string,
    private readonly isAsset: (entry: TreeEntry) => boolean,
    private readonly typeOf: (path: string) => string | undefined,
    /** True while the user waits on something; scanning steps aside until it is done. */
    private readonly busy: () => boolean,
    /** Asset types indexed (handler ids), so adding a type re-lists every branch once. */
    private readonly types: string,
    private readonly emit: (status: CatalogStatus) => void
  ) {}

  status(): CatalogStatus {
    return this.state
  }

  /** Reads branch lists (when stale) and queues every branch not indexed yet; recent branches go first. */
  async scan(repos: readonly RepoRef[], current?: { repo: string; branch?: string }, force = false): Promise<CatalogStatus> {
    if (this.stopped) return this.state
    const loaded = await Promise.all(repos.map((r) => this.load(r.fullName)))
    const stale = repos.filter((_r, i) => force || !loaded[i].checkedAt || Date.now() - loaded[i].checkedAt! > REFRESH_MS)
    if (stale.length) {
      this.update({ state: 'running', current: undefined, error: undefined })
      let next = 0
      const refresh = async () => {
        while (next < stale.length && !this.stopped) {
          const repo = stale[next++]
          try {
            const catalog = await this.load(repo.fullName)
            catalog.setBranches(await this.source.listBranchHeads(repo.fullName), repo.defaultBranch)
            this.scheduleSave(catalog)
          } catch (err) {
            if (err instanceof SourceError && err.code === 'rateLimited') throw err
            // A repo we cannot read (no access, archived…) just has no branches.
          }
        }
      }
      try {
        await Promise.all(Array.from({ length: HEADS_CONCURRENCY }, refresh))
      } catch (err) {
        this.fail(err)
        return this.state
      }
    }
    const tasks = planScan(await Promise.all(repos.map((r) => this.load(r.fullName))))
    const queued = new Set(this.queue.map((t) => `${t.repo}@${t.commit}`))
    const added = tasks.filter((t) => !queued.has(`${t.repo}@${t.commit}`))
    // What the user has open goes first: its branch, then its repo; recent branches before old ones.
    const rank = (t: ScanTask) =>
      (current && t.repo === current.repo && t.branch === current.branch ? 0 : 4) + (t.recent ? 0 : 2) + (current && t.repo === current.repo ? 0 : 1)
    const all = [...this.queue, ...added]
    this.queue = all.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t)
    if (this.state.state !== 'running' || !this.worker) this.update({ done: 0, total: this.queue.length })
    else this.update({ total: this.state.done + this.queue.length })
    this.start()
    return this.state
  }

  pause(): CatalogStatus {
    if (this.state.state === 'running') this.update({ state: 'paused', current: undefined })
    return this.state
  }

  resume(): CatalogStatus {
    clearTimeout(this.resumeTimer)
    if (this.state.state !== 'running' && this.queue.length) {
      this.update({ state: 'running', error: undefined })
      this.start()
    }
    return this.state
  }

  /** Signed out: stop for good, but keep what was saved. */
  stop(): void {
    this.stopped = true
    this.queue = []
    clearTimeout(this.resumeTimer)
    for (const [repo, timer] of this.saveTimers) {
      clearTimeout(timer)
      void this.catalogs.get(repo)?.then((c) => this.save(c))
    }
  }

  /** Every indexed asset in these repos (all saved repos when `repos` is empty), identical files grouped. */
  async list(repos: readonly string[], excludedFolders: readonly string[]): Promise<CatalogAsset[]> {
    const names = repos.length ? repos : await this.savedRepos()
    const key = JSON.stringify([names, excludedFolders])
    if (this.listed?.key !== key || this.listed.version !== this.version) {
      const version = this.version
      const result = Promise.all(names.map((r) => this.load(r))).then((catalogs) => groupCatalog(catalogs, this.typeOf, excludedFolders))
      this.listed = { key, version, result }
    }
    return this.listed.result
  }

  /** Where else a file with this content is, in every saved repo. */
  async whereIs(sha: string): Promise<CatalogLocation[]> {
    return whereIs(await Promise.all((await this.savedRepos()).map((r) => this.load(r))), sha)
  }

  private start(): void {
    if (this.worker || this.stopped || this.state.state === 'paused' || !this.queue.length) {
      if (!this.queue.length && !this.worker && this.state.state === 'running') this.update({ state: 'idle', current: undefined })
      return
    }
    this.update({ state: 'running' })
    this.worker = Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => this.work())).then(() => {
      this.worker = undefined
      if (this.state.state === 'running') this.update({ state: this.queue.length ? 'running' : 'idle', current: undefined })
      if (this.queue.length && this.state.state === 'running') this.start()
    })
  }

  private async work(): Promise<void> {
    while (this.queue.length && this.state.state === 'running' && !this.stopped) {
      while (this.busy() && !this.stopped) await new Promise((r) => setTimeout(r, 250))
      if (this.state.state !== 'running' || this.stopped) return
      const task = this.queue.shift()
      if (!task) return
      const catalog = await this.load(task.repo)
      // The branch moved on (or was listed by another task) since it was queued.
      if (catalog.hasCommit(task.commit) || !catalog.branches.some((b) => b.commit === task.commit)) {
        this.update({ done: this.state.done + 1 })
        continue
      }
      this.update({ current: `${task.repo}@${task.branch}` })
      try {
        catalog.addCommit(task.commit, await this.source.assetEntriesAt(task.repo, task.commit, this.isAsset))
      } catch (err) {
        if (err instanceof SourceError && (err.code === 'rateLimited' || err.code === 'network' || err.code === 'unauthorized')) {
          // Worth trying again later: put it back.
          this.queue.unshift(task)
          this.fail(err)
          return
        }
        catalog.markFailed(task.commit, err instanceof SourceError ? err.code : 'unknown')
      }
      this.scheduleSave(catalog)
      this.update({ done: this.state.done + 1 })
    }
  }

  private fail(err: unknown): void {
    const error: IpcError =
      err instanceof SourceError ? { code: err.code, message: err.message, ...err.detail } : { code: 'unknown', message: err instanceof Error ? err.message : String(err) }
    this.update({ state: 'error', error, current: undefined })
    // Rate limits lift on their own: carry on a little after the reset time.
    if (error.code === 'rateLimited') {
      const wait = Math.max(60_000, (error.resetAt ?? Date.now() + 15 * 60_000) - Date.now() + 5_000)
      clearTimeout(this.resumeTimer)
      this.resumeTimer = setTimeout(() => this.resume(), wait)
    }
  }

  private load(repo: string): Promise<RepoCatalog> {
    let catalog = this.catalogs.get(repo)
    if (!catalog) {
      catalog = readFile(join(this.dir(), fileName(repo)), 'utf8').then(
        (text) => RepoCatalog.parse(repo, JSON.parse(text), this.types),
        () => RepoCatalog.empty(repo, this.types)
      )
      this.catalogs.set(repo, catalog)
    }
    return catalog
  }

  private async savedRepos(): Promise<string[]> {
    const names = new Set<string>()
    try {
      for (const f of await readdir(this.dir())) {
        if (!f.endsWith('.json')) continue
        try {
          const repo = (JSON.parse(await readFile(join(this.dir(), f), 'utf8')) as { repo?: string }).repo
          if (repo) names.add(repo)
        } catch {
          // unreadable file: skipped
        }
      }
    } catch {
      // no catalog yet
    }
    for (const repo of this.catalogs.keys()) names.add(repo)
    return [...names]
  }

  private scheduleSave(catalog: RepoCatalog): void {
    this.version++
    if (this.saveTimers.has(catalog.repo)) return
    this.saveTimers.set(
      catalog.repo,
      setTimeout(() => {
        this.saveTimers.delete(catalog.repo)
        void this.save(catalog)
      }, SAVE_DELAY_MS)
    )
  }

  private save(catalog: RepoCatalog): Promise<void> {
    return writeAtomic(join(this.dir(), fileName(catalog.repo)), JSON.stringify(catalog.toJSON())).catch(() => {})
  }

  /** Progress reaches the UI at most a few times a second. */
  private update(patch: Partial<CatalogStatus>): void {
    this.state = { ...this.state, ...patch }
    const now = Date.now()
    const send = () => {
      this.lastEmit = Date.now()
      this.emitTimer = undefined
      this.emit(this.state)
    }
    if (patch.state || now - this.lastEmit > 300) {
      clearTimeout(this.emitTimer)
      send()
    } else if (!this.emitTimer) this.emitTimer = setTimeout(send, 300)
  }
}
