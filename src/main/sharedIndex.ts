import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { gunzip, gzip } from 'zlib'
import { SHARED_FACT_KINDS, type GitHubAssetSource } from '@core/github/source'
import { CARD_VERSIONS, newerCard, type StatsSummary } from '@core/checks/playable'
import type { SharedIndexManifest, SharedIndexResult, SharedIndexStatus } from '@shared/ipc'
import type { IndexRepo } from './indexRepo'
import type { CatalogService } from './catalog'
import { writeAtomic, type StatsStore, type ThumbnailStore } from './caches'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** Folder the index is written to, inside the shared folder the user picks. */
export const INDEX_FOLDER = 'AssetHubIndex'
const FORMAT = 1
/** Thumbnails copied at once (a network drive is slow per file, not per byte). */
const COPY_CONCURRENCY = 8

const repoFile = (repo: string) => `${repo.replace('/', '__').replace(/[^A-Za-z0-9._-]/g, '_')}.json.gz`

const readJsonGz = async <T>(file: string): Promise<T> => JSON.parse((await gunzipAsync(await readFile(file))).toString('utf8')) as T
const writeJsonGz = async (file: string, value: unknown) => writeAtomic(file, await gzipAsync(JSON.stringify(value)))
/** Keys in order: the same data gives the same bytes on every machine, so a git-backed index sees no change. */
const sorted = <T>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]))
/** Every key of `want` is in `have`. */
const covers = (have: object | undefined, want: object) => !!have && Object.keys(want).every((k) => k in have)
const list = (dir: string) => readdir(dir).catch(() => [] as string[])

async function inBatches<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

export async function readManifest(root: string): Promise<SharedIndexManifest | undefined> {
  try {
    const m = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as SharedIndexManifest
    return m?.format === FORMAT && typeof m.exportedAt === 'string' ? m : undefined
  } catch {
    return undefined
  }
}

interface Deps {
  catalog: CatalogService
  source: GitHubAssetSource
  stats: StatsStore
  thumbs: ThumbnailStore
}

/** `<sha>` or `<sha>.fx` (the moving effect card) → the asset's key. */
const keyOf = (name: string) => name.replace(/\.fx$/, '')

/**
 * Takes in a shared index: catalogs, facts, measurements and thumbnails this
 * app does not have. What was found here stays, except cards drawn an older
 * way (see `CARD_VERSIONS`), which the index's newer ones replace.
 */
export async function importIndex(root: string, deps: Deps): Promise<SharedIndexResult> {
  const result: SharedIndexResult = { commits: 0, facts: 0, stats: 0, thumbs: 0 }
  for (const f of await list(join(root, 'catalog'))) {
    if (f.endsWith('.json.gz')) result.commits += await deps.catalog.merge(await readJsonGz(join(root, 'catalog', f)).catch(() => undefined))
  }
  for (const kind of SHARED_FACT_KINDS) {
    for (const f of await list(join(root, 'facts', kind))) {
      const data = await readJsonGz<{ repo?: string; facts?: Record<string, unknown> }>(join(root, 'facts', kind, f)).catch(() => undefined)
      if (typeof data?.repo === 'string' && data.facts && typeof data.facts === 'object') result.facts += await deps.source.mergeSharedFacts(kind, data.repo, data.facts)
    }
  }
  const shared = await readJsonGz<Record<string, StatsSummary>>(join(root, 'stats.json.gz')).catch(() => ({}) as Record<string, StatsSummary>)
  const local = await deps.stats.all()
  const here = new Set(await deps.thumbs.names())
  const newer = (key: string) => newerCard(shared[key], local[key])
  const names = (await list(join(root, 'thumbs'))).filter((f) => f.endsWith('.img')).map((f) => f.slice(0, -4))
  await inBatches(
    names.filter((n) => !here.has(n) || newer(keyOf(n))),
    async (name) => {
      const bytes = await readFile(join(root, 'thumbs', `${name}.img`)).catch(() => undefined)
      if (bytes && (await deps.thumbs.importFile(name, new Uint8Array(bytes), newer(keyOf(name))))) result.thumbs++
    }
  )
  result.stats = await deps.stats.importMany(shared)
  // Cards replaced above: the measurement says so, or they would be drawn again.
  for (const key of Object.keys(shared)) {
    if (!local[key] || !newer(key)) continue
    const versions = Object.fromEntries(CARD_VERSIONS.flatMap((f) => (shared[key][f] !== undefined ? [[f, shared[key][f]]] : [])))
    await deps.stats.save(key, { ...local[key], ...versions })
  }
  return result
}

/**
 * Writes this app's index to the shared folder, after taking in what others
 * wrote there (so nobody's work is lost). Thumbnails already there are left
 * alone unless this app drew a newer kind of card; the manifest goes last,
 * so a reader never sees it before the files it lists.
 */
export async function exportIndex(root: string, deps: Deps, by: string | undefined, types: string, include: (repo: string) => boolean = () => true): Promise<SharedIndexResult> {
  if (await readManifest(root)) await importIndex(root, deps)
  await mkdir(join(root, 'thumbs'), { recursive: true })
  const catalogs = (await deps.catalog.snapshot()).filter((c) => include(c.repo))
  // What is there already was taken in above, so a file is written again only when this app knows more.
  for (const c of catalogs) {
    const file = join(root, 'catalog', repoFile(c.repo))
    const there = await readJsonGz<typeof c>(file).catch(() => undefined)
    const same = there && covers(there.commits, c.commits) && there.defaultBranch === c.defaultBranch && JSON.stringify(there.branches) === JSON.stringify(c.branches)
    if (!same) await writeJsonGz(file, c)
  }
  let facts = 0
  for (const kind of SHARED_FACT_KINDS) {
    // Every repo with facts, not only scanned ones: the GUIDs of a branch opened once are what make
    // its first model or prefab slow (15 s and more) on the next Mac.
    const repos = [...new Set([...catalogs.map((c) => c.repo), ...(await deps.source.factRepos(kind)).filter(include)])]
    for (const repo of repos) {
      const known = await deps.source.sharedFacts(kind, repo)
      const n = Object.keys(known).length
      if (!n) continue
      const file = join(root, 'facts', kind, repoFile(repo))
      const there = await readJsonGz<{ facts?: Record<string, unknown> }>(file).catch(() => undefined)
      if (!covers(there?.facts, known)) await writeJsonGz(file, { repo, facts: sorted(known) })
      facts += n
    }
  }
  const sharedBefore = await readJsonGz<Record<string, StatsSummary>>(join(root, 'stats.json.gz')).catch(() => ({}) as Record<string, StatsSummary>)
  const stats = sorted(await deps.stats.all())
  const flat = (r: Record<string, StatsSummary>) => JSON.stringify(Object.entries(sorted(r)).map(([k, v]) => [k, sorted(v as unknown as Record<string, unknown>)]))
  if (flat(stats) !== flat(sharedBefore)) await writeJsonGz(join(root, 'stats.json.gz'), stats)
  const there = new Set((await list(join(root, 'thumbs'))).filter((f) => f.endsWith('.img')).map((f) => f.slice(0, -4)))
  const names = await deps.thumbs.names()
  let thumbs = 0
  await inBatches(
    names.filter((n) => !there.has(n) || newerCard(stats[keyOf(n)], sharedBefore[keyOf(n)])),
    async (name) => {
      const found = await deps.thumbs.read(name)
      if (!found) return
      await writeAtomic(join(root, 'thumbs', `${name}.img`), found.bytes)
      thumbs++
    }
  )
  const manifest: SharedIndexManifest = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    exportedBy: by,
    types,
    repos: catalogs.map((c) => ({ repo: c.repo, branches: c.branches.length, commits: Object.keys(c.commits).length })),
    thumbs: there.size + thumbs,
    stats: Object.keys(stats).length
  }
  await writeAtomic(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { commits: catalogs.reduce((n, c) => n + Object.keys(c.commits).length, 0), facts, stats: manifest.stats, thumbs }
}

/** What was imported last, so the same index is not taken in twice. */
interface Seen {
  dir: string
  exportedAt: string
}

/** A teammate's index this new is not written over by an automatic contribution. */
export const CONTRIBUTE_AFTER_MS = 2 * 60 * 60_000
/** Tries this many times when others push first. */
const PUSH_ATTEMPTS = 4

/**
 * Keeps this app in step with the team's shared index: a folder the user picks or, when none
 * is picked, the GitHub repo (`IndexRepo`). Takes it in when a newer one appears (at sign-in,
 * every so often, or when asked) and writes it when asked. With the GitHub repo, it also
 * writes its own index there on its own when the shared one is old and this app knows more.
 */
export class SharedIndexService {
  private state: SharedIndexStatus = { state: 'idle' }
  private running?: Promise<void>
  private readOnly = false
  private lastContribution = 0

  constructor(
    private readonly deps: Deps,
    private readonly dir: () => string | undefined,
    private readonly seenFile: () => string,
    private readonly types: string,
    private readonly login: string | undefined,
    private readonly emit: (status: SharedIndexStatus) => void,
    private readonly repo?: IndexRepo
  ) {}

  /** The GitHub repo is used when no folder is picked. */
  private github(): IndexRepo | undefined {
    return this.dir() ? undefined : this.repo
  }

  private root(): string | undefined {
    const dir = this.dir()
    return dir ? join(dir, INDEX_FOLDER) : this.repo?.dir
  }

  /** Personal repos stay out of the team's index. */
  private include = (repo: string): boolean => !this.github() || !this.login || repo.split('/')[0].toLowerCase() !== this.login.toLowerCase()

  async status(): Promise<SharedIndexStatus> {
    const root = this.root()
    const github = this.github()
    return {
      ...this.state,
      via: github ? 'github' : this.dir() ? 'folder' : undefined,
      repo: github?.repo,
      readOnly: github ? this.readOnly : undefined,
      manifest: root ? await readManifest(root) : undefined,
      importedAt: (await this.seen())?.exportedAt
    }
  }

  /** Takes in the shared index when it is newer than the one taken in last; with GitHub, may then contribute. */
  check(): Promise<void> {
    return this.run('importing', async (root) => {
      await this.github()?.pull()
      const manifest = await readManifest(root)
      const seen = await this.seen()
      let result: SharedIndexResult | undefined
      // Made for other asset types, its catalogs are left out (`CatalogService.merge`); the rest still counts.
      if (manifest && !(seen?.dir === root && seen.exportedAt === manifest.exportedAt)) {
        result = await importIndex(root, this.deps)
        await this.remember(root, manifest.exportedAt)
      }
      if (this.shouldContribute(manifest)) {
        this.lastContribution = Date.now()
        this.update({ state: 'exporting' })
        // Failing to contribute (offline, no write access) leaves what was taken in as it is.
        const wrote = await this.write(root, true).catch(() => undefined)
        if (wrote) return { result: wrote, action: 'exported' as const }
      }
      return result && { result, action: 'imported' as const }
    })
  }

  private shouldContribute(manifest: SharedIndexManifest | undefined): boolean {
    if (!this.github() || this.readOnly) return false
    if (Date.now() - this.lastContribution < CONTRIBUTE_AFTER_MS) return false
    return !manifest || Date.now() - Date.parse(manifest.exportedAt) >= CONTRIBUTE_AFTER_MS
  }

  importNow(): Promise<void> {
    return this.run('importing', async (root) => {
      await this.github()?.pull()
      const manifest = await readManifest(root)
      if (!manifest) throw new Error('noIndex')
      const result = await importIndex(root, this.deps)
      await this.remember(root, manifest.exportedAt)
      return { result, action: 'imported' as const }
    })
  }

  exportNow(): Promise<void> {
    return this.run('exporting', async (root) => {
      const result = await this.write(root, false)
      return result && { result, action: 'exported' as const }
    })
  }

  /**
   * Writes this app's index. With GitHub: on top of the latest commit, pushed without forcing;
   * when someone pushed first, pulls their work, takes it in and writes again. Returns undefined
   * when an automatic contribution had nothing new.
   */
  private async write(root: string, automatic: boolean): Promise<SharedIndexResult | undefined> {
    const github = this.github()
    if (!github) {
      const result = await exportIndex(root, this.deps, this.login, this.types)
      const manifest = await readManifest(root)
      if (manifest) await this.remember(root, manifest.exportedAt)
      return result
    }
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
      // On top of the latest commit; after a refused push, that has the work of whoever pushed first.
      await github.pull()
      const result = await exportIndex(root, this.deps, this.login, this.types, this.include)
      const pushed = await github.push(`${automatic ? 'Update' : 'Write'} index (${this.login ?? 'unknown'})`)
      if (pushed === 'readOnly') {
        this.readOnly = true
        await github.discard()
        throw new Error('readOnly')
      }
      if (pushed === 'behind') continue
      const manifest = await readManifest(root)
      if (pushed === 'pushed' && manifest) await this.remember(root, manifest.exportedAt)
      return pushed === 'unchanged' && automatic ? undefined : result
    }
    await github.discard()
    throw new Error('busy')
  }

  private run(state: 'importing' | 'exporting', fn: (root: string) => Promise<{ result: SharedIndexResult; action: 'imported' | 'exported' } | undefined>): Promise<void> {
    if (this.running) return this.running
    const root = this.root()
    if (!root) return Promise.resolve()
    this.update({ state, error: undefined })
    this.running = fn(root)
      .then(
        (done) => this.update({ state: 'idle', ...(done ? { last: done.result, lastAction: done.action } : {}) }),
        (err) => this.update({ state: 'error', error: err instanceof Error ? err.message : String(err) })
      )
      .finally(() => (this.running = undefined))
    return this.running
  }

  private emitted = 0

  private update(patch: Partial<SharedIndexStatus>): void {
    this.state = { ...this.state, ...patch }
    // status() reads files: an older update finishing late must not overwrite a newer one.
    const n = ++this.emitted
    void this.status().then((s) => n === this.emitted && this.emit(s))
  }

  private async seen(): Promise<Seen | undefined> {
    try {
      return JSON.parse(await readFile(this.seenFile(), 'utf8')) as Seen
    } catch {
      return undefined
    }
  }

  private remember(dir: string, exportedAt: string): Promise<void> {
    return writeAtomic(this.seenFile(), JSON.stringify({ dir, exportedAt } satisfies Seen))
  }
}
