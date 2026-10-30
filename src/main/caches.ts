import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { gunzip, gzip } from 'zlib'
import { isStatsSummary, keepCardVersions, mergeStats, type StatsSummary } from '@core/checks/playable'
import type { BlobCache, CommitCache } from '@core/github/source'
import type { CacheUsage } from '@shared/ipc'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_')

let tmpCounter = 0

/** Write to a unique temp file, then rename over the target: overlapping writes of one key no longer collide. */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** Marks a cached file as just used, so the size limit removes others first. */
const touch = (file: string) => {
  const now = new Date()
  void utimes(file, now, now).catch(() => {})
}

/**
 * `<cacheDir>/<kind>/<owner>__<repo>/<commit>.json.gz` — trees, GUID indexes…
 * Gzipped: a tree listing shrinks about 6×. Files from before (plain `.json`)
 * are still read, and rewritten compressed.
 */
export class FileCommitCache implements CommitCache {
  constructor(
    private readonly cacheDir: () => string,
    private readonly onWrite?: (bytes: number) => void
  ) {}

  private file(kind: string, repo: string, commitSha: string): string {
    return join(this.cacheDir(), safe(kind), safe(repo.replace('/', '__')), `${safe(commitSha)}.json.gz`)
  }

  async get<T>(kind: string, repo: string, commitSha: string): Promise<T | undefined> {
    const file = this.file(kind, repo, commitSha)
    try {
      const value = JSON.parse((await gunzipAsync(await readFile(file))).toString('utf8')) as T
      touch(file)
      return value
    } catch {
      return this.migrate<T>(kind, repo, commitSha)
    }
  }

  async set(kind: string, repo: string, commitSha: string, value: unknown): Promise<void> {
    const bytes = await gzipAsync(JSON.stringify(value))
    await writeAtomic(this.file(kind, repo, commitSha), bytes)
    this.onWrite?.(bytes.byteLength)
  }

  /** An uncompressed file from an earlier version: read once, then stored compressed. */
  private async migrate<T>(kind: string, repo: string, commitSha: string): Promise<T | undefined> {
    const legacy = this.file(kind, repo, commitSha).replace(/\.gz$/, '')
    try {
      const value = JSON.parse(await readFile(legacy, 'utf8')) as T
      await this.set(kind, repo, commitSha, value)
      await rm(legacy, { force: true })
      return value
    } catch {
      return undefined
    }
  }
}

/** `<cacheDir>/blobs/<ab>/<hash>` — downloaded file contents, shared across repos and branches. */
export class FileBlobCache implements BlobCache {
  constructor(
    private readonly cacheDir: () => string,
    private readonly onWrite?: (bytes: number) => void
  ) {}

  private file(key: string): string {
    const k = safe(key)
    return join(this.cacheDir(), 'blobs', k.slice(0, 2), k)
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const file = this.file(key)
    try {
      const bytes = new Uint8Array(await readFile(file))
      touch(file)
      return bytes
    } catch {
      return undefined
    }
  }

  async set(key: string, bytes: Uint8Array): Promise<void> {
    await writeAtomic(this.file(key), bytes)
    this.onWrite?.(bytes.byteLength)
  }
}

/** Scheme thumbnails are served on, so pages load them as files instead of receiving them over IPC. */
export const THUMB_SCHEME = 'assethub-thumb'

/** Image type from a file's first bytes (thumbnails are WebP, older ones may be PNG or JPEG). */
function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  return 'image/webp'
}

/**
 * Preview thumbnails as image files (`<cacheDir>/thumbs/<key>.img`), keyed by
 * the asset's content hash. Pages get URLs on `THUMB_SCHEME` and load only the
 * images on screen. Thumbnails saved as data-URL text (`.txt`) by earlier
 * versions are served too, and converted when read.
 */
export class ThumbnailStore {
  /** Thumbnails on disk per cache folder, with a version that changes when one is drawn again. */
  private readonly indexes = new Map<string, Promise<Map<string, number>>>()

  constructor(private readonly cacheDir: () => string) {}

  private dir(): string {
    return join(this.cacheDir(), 'thumbs')
  }

  private index(): Promise<Map<string, number>> {
    const dir = this.dir()
    let index = this.indexes.get(dir)
    if (!index) {
      index = readdir(dir).then(
        (names) => new Map(names.filter((n) => /\.(img|txt)$/.test(n)).map((n) => [n.replace(/\.(img|txt)$/, ''), 0])),
        () => new Map<string, number>()
      )
      this.indexes.set(dir, index)
    }
    return index
  }

  /** URLs of the thumbnails that exist among `keys`. */
  async getMany(keys: readonly string[]): Promise<Record<string, string>> {
    const index = await this.index()
    const out: Record<string, string> = {}
    for (const k of keys) {
      const version = index.get(safe(k))
      if (version !== undefined) out[k] = `${THUMB_SCHEME}://t/${encodeURIComponent(safe(k))}?v=${version}`
    }
    return out
  }

  /** The image behind a thumbnail URL's name. */
  async read(name: string): Promise<{ bytes: Uint8Array; type: string } | undefined> {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return undefined
    const file = join(this.dir(), `${name}.img`)
    try {
      const bytes = new Uint8Array(await readFile(file))
      return { bytes, type: imageType(bytes) }
    } catch {
      // Not converted yet: an earlier version's data URL.
    }
    try {
      const legacy = join(this.dir(), `${name}.txt`)
      const bytes = decodeDataUrl(await readFile(legacy, 'utf8'))
      if (!bytes) return undefined
      await writeAtomic(file, bytes)
      await rm(legacy, { force: true })
      return { bytes, type: imageType(bytes) }
    } catch {
      return undefined
    }
  }

  async save(key: string, dataUrl: string): Promise<void> {
    if (dataUrl.length > 2_000_000) return
    const bytes = decodeDataUrl(dataUrl)
    if (!bytes) return
    const name = safe(key)
    await writeAtomic(join(this.dir(), `${name}.img`), bytes)
    await rm(join(this.dir(), `${name}.txt`), { force: true })
    ;(await this.index()).set(name, Date.now())
  }

  /** Names of every thumbnail on disk (keys as stored), for a shared index. */
  async names(): Promise<string[]> {
    return [...(await this.index()).keys()]
  }

  /** Adds a thumbnail from a shared index; one already here stays unless `replace` (a newer kind of card). */
  async importFile(name: string, bytes: Uint8Array, replace = false): Promise<boolean> {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return false
    const index = await this.index()
    if (index.has(name) && !replace) return false
    await rm(join(this.dir(), `${name}.txt`), { force: true })
    await writeAtomic(join(this.dir(), `${name}.img`), bytes)
    index.set(name, Date.now())
    return true
  }
}

function decodeDataUrl(dataUrl: string): Uint8Array | undefined {
  const m = /^data:image\/(png|webp|jpeg);base64,/.exec(dataUrl)
  return m ? new Uint8Array(Buffer.from(dataUrl.slice(m[0].length), 'base64')) : undefined
}

/** Model measurements by content SHA, in one small JSON file (`<cacheDir>/stats.json`). */
export class StatsStore {
  private data?: Promise<Record<string, StatsSummary>>
  private timer?: NodeJS.Timeout

  constructor(private readonly cacheDir: () => string) {}

  private file(): string {
    return join(this.cacheDir(), 'stats.json')
  }

  private load(): Promise<Record<string, StatsSummary>> {
    this.data ??= readFile(this.file(), 'utf8').then(
      (text) => {
        const raw = JSON.parse(text) as Record<string, unknown>
        return Object.fromEntries(Object.entries(raw).filter((e): e is [string, StatsSummary] => isStatsSummary(e[1])))
      },
      () => ({})
    )
    return this.data
  }

  async getMany(keys: readonly string[]): Promise<Record<string, StatsSummary>> {
    const all = await this.load()
    const out: Record<string, StatsSummary> = {}
    for (const k of keys) if (all[k]) out[k] = all[k]
    return out
  }

  /** Every measurement, for a shared index. */
  async all(): Promise<Record<string, StatsSummary>> {
    return { ...(await this.load()) }
  }

  /**
   * Measurements from a shared index: taken where none is known here, or
   * where it is fuller (a viewer measurement over a thumbnail one). Returns how many were taken.
   */
  async importMany(raw: unknown): Promise<number> {
    if (!raw || typeof raw !== 'object') return 0
    const all = await this.load()
    let taken = 0
    for (const [key, summary] of Object.entries(raw as Record<string, unknown>)) {
      if (!isStatsSummary(summary)) continue
      const kept = all[key]
      if (kept && !(kept.source === 'thumb' && summary.source === 'viewer')) continue
      all[key] = keepCardVersions(kept, summary)
      taken++
    }
    if (taken) this.scheduleWrite(all)
    return taken
  }

  async save(key: string, summary: unknown): Promise<void> {
    if (!isStatsSummary(summary)) return
    const all = await this.load()
    all[key] = mergeStats(all[key], summary)
    this.scheduleWrite(all)
  }

  private scheduleWrite(all: Record<string, StatsSummary>): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void writeAtomic(this.file(), JSON.stringify(all)).catch(() => {}), 1000)
  }
}

/** Downloaded data that can always be fetched again: what the size limit removes, least recently used first. */
const DOWNLOADS = ['blobs', 'tree', 'guids']
/** Folders older versions wrote and nothing reads any more. */
const STALE = ['prefabfx', 'prefabfx2']
/** Below the limit by this much after a cleanup, so it does not run again on the next download. */
const PRUNE_TO = 0.9
/** Downloads written between two checks of the limit. */
const CHECK_EVERY = 200 * 1024 * 1024
/** Temp files this old are left over from a crash, not a write in progress. */
const STALE_TMP_MS = 60 * 60 * 1000

interface CachedFile {
  path: string
  size: number
  used: number
}

async function filesUnder(dir: string): Promise<CachedFile[]> {
  let entries
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e) => {
        const path = join(e.parentPath, e.name)
        try {
          const s = await stat(path)
          return { path, size: s.size, used: s.mtimeMs }
        } catch {
          return undefined
        }
      })
  )
  return files.filter((f): f is CachedFile => !!f)
}

/**
 * Keeps the cache folder in bounds: downloads beyond the size limit go,
 * least recently used first; leftovers of older versions and crashed writes
 * are removed at launch. Only folders the app writes are touched (the cache
 * folder may be one the user picked).
 */
export class CacheJanitor {
  private written = 0
  private running?: Promise<void>

  constructor(
    private readonly cacheDir: () => string,
    /** Bytes; 0 for no limit. */
    private readonly limit: () => number
  ) {}

  /** Counts a download written; checks the limit every so often. */
  noteWrite = (bytes: number): void => {
    this.written += bytes
    if (this.written < CHECK_EVERY) return
    this.written = 0
    void this.prune()
  }

  async usage(): Promise<CacheUsage> {
    const root = this.cacheDir()
    const sum = (files: CachedFile[]) => files.reduce((n, f) => n + f.size, 0)
    const all = await filesUnder(root)
    const downloads = sum((await Promise.all(DOWNLOADS.map((d) => filesUnder(join(root, d))))).flat())
    const thumbs = sum(await filesUnder(join(root, 'thumbs')))
    return { downloads, thumbs, other: Math.max(0, sum(all) - downloads - thumbs) }
  }

  /** Removes the least recently used downloads until they fit the limit. */
  prune(): Promise<void> {
    this.running ??= this.pruneNow().finally(() => (this.running = undefined))
    return this.running
  }

  private async pruneNow(): Promise<void> {
    const limit = this.limit()
    if (!limit) return
    const root = this.cacheDir()
    const files = (await Promise.all(DOWNLOADS.map((d) => filesUnder(join(root, d))))).flat()
    let total = files.reduce((n, f) => n + f.size, 0)
    if (total <= limit) return
    for (const f of files.sort((a, b) => a.used - b.used)) {
      if (total <= limit * PRUNE_TO) break
      await rm(f.path, { force: true }).catch(() => {})
      total -= f.size
    }
  }

  /** Leftovers: folders of older versions, temp files of interrupted writes. */
  async cleanStale(): Promise<void> {
    const root = this.cacheDir()
    await Promise.all(STALE.map((d) => rm(join(root, d), { recursive: true, force: true }).catch(() => {})))
    const now = Date.now()
    for (const f of await filesUnder(root)) if (f.path.endsWith('.tmp') && now - f.used > STALE_TMP_MS) await rm(f.path, { force: true }).catch(() => {})
  }

  /** Empties the downloads (they come back as they are needed); thumbnails and measurements stay. */
  async clear(): Promise<void> {
    const root = this.cacheDir()
    await Promise.all(DOWNLOADS.map((d) => rm(join(root, d), { recursive: true, force: true })))
  }
}
