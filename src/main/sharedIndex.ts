import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { gunzip, gzip } from 'zlib'
import { SHARED_FACT_KINDS, type GitHubAssetSource } from '@core/github/source'
import { CARD_VERSIONS, newerCard, type StatsSummary } from '@core/checks/playable'
import type { SharedIndexManifest, SharedIndexResult, SharedIndexStatus } from '@shared/ipc'
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
export async function exportIndex(root: string, deps: Deps, by: string | undefined, types: string): Promise<SharedIndexResult> {
  if (await readManifest(root)) await importIndex(root, deps)
  await mkdir(join(root, 'thumbs'), { recursive: true })
  const catalogs = await deps.catalog.snapshot()
  for (const c of catalogs) await writeJsonGz(join(root, 'catalog', repoFile(c.repo)), c)
  let facts = 0
  for (const kind of SHARED_FACT_KINDS) {
    for (const c of catalogs) {
      const known = await deps.source.sharedFacts(kind, c.repo)
      const n = Object.keys(known).length
      if (!n) continue
      await writeJsonGz(join(root, 'facts', kind, repoFile(c.repo)), { repo: c.repo, facts: known })
      facts += n
    }
  }
  const sharedBefore = await readJsonGz<Record<string, StatsSummary>>(join(root, 'stats.json.gz')).catch(() => ({}) as Record<string, StatsSummary>)
  const stats = await deps.stats.all()
  await writeJsonGz(join(root, 'stats.json.gz'), stats)
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

/**
 * Keeps this app in step with a shared index folder: takes it in when a newer
 * one appears (at sign-in, every so often, or when asked) and writes it when asked.
 */
export class SharedIndexService {
  private state: SharedIndexStatus = { state: 'idle' }
  private running?: Promise<void>

  constructor(
    private readonly deps: Deps,
    private readonly dir: () => string | undefined,
    private readonly seenFile: () => string,
    private readonly types: string,
    private readonly login: string | undefined,
    private readonly emit: (status: SharedIndexStatus) => void
  ) {}

  private root(): string | undefined {
    const dir = this.dir()
    return dir ? join(dir, INDEX_FOLDER) : undefined
  }

  async status(): Promise<SharedIndexStatus> {
    const root = this.root()
    return { ...this.state, manifest: root ? await readManifest(root) : undefined, importedAt: (await this.seen())?.exportedAt }
  }

  /** Takes in the shared index when it is newer than the one taken in last. */
  check(): Promise<void> {
    return this.run('importing', async (root) => {
      const manifest = await readManifest(root)
      const seen = await this.seen()
      // Made for other asset types, its catalogs are left out (`CatalogService.merge`); the rest still counts.
      if (!manifest || (seen?.dir === root && seen.exportedAt === manifest.exportedAt)) return undefined
      const result = await importIndex(root, this.deps)
      await this.remember(root, manifest.exportedAt)
      return result
    })
  }

  importNow(): Promise<void> {
    return this.run('importing', async (root) => {
      const manifest = await readManifest(root)
      if (!manifest) throw new Error('noIndex')
      const result = await importIndex(root, this.deps)
      await this.remember(root, manifest.exportedAt)
      return result
    })
  }

  exportNow(): Promise<void> {
    return this.run('exporting', async (root) => {
      const result = await exportIndex(root, this.deps, this.login, this.types)
      const manifest = await readManifest(root)
      if (manifest) await this.remember(root, manifest.exportedAt)
      return result
    })
  }

  private run(state: 'importing' | 'exporting', fn: (root: string) => Promise<SharedIndexResult | undefined>): Promise<void> {
    if (this.running) return this.running
    const root = this.root()
    if (!root) return Promise.resolve()
    this.update({ state, error: undefined })
    this.running = fn(root)
      .then(
        (last) => this.update({ state: 'idle', ...(last ? { last, lastAction: state === 'importing' ? 'imported' : 'exported' } : {}) }),
        (err) => this.update({ state: 'error', error: err instanceof Error ? err.message : String(err) })
      )
      .finally(() => (this.running = undefined))
    return this.running
  }

  private update(patch: Partial<SharedIndexStatus>): void {
    this.state = { ...this.state, ...patch }
    void this.status().then(this.emit)
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
