import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { BlobCache, CommitCache } from '@core/github/source'

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

/** `<cacheDir>/<kind>/<owner>__<repo>/<commit>.json` — trees, GUID indexes… */
export class FileCommitCache implements CommitCache {
  constructor(private readonly cacheDir: () => string) {}

  private file(kind: string, repo: string, commitSha: string): string {
    return join(this.cacheDir(), safe(kind), safe(repo.replace('/', '__')), `${safe(commitSha)}.json`)
  }

  async get<T>(kind: string, repo: string, commitSha: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.file(kind, repo, commitSha), 'utf8')) as T
    } catch {
      return undefined
    }
  }

  set(kind: string, repo: string, commitSha: string, value: unknown): Promise<void> {
    return writeAtomic(this.file(kind, repo, commitSha), JSON.stringify(value))
  }
}

/** `<cacheDir>/blobs/<ab>/<hash>` — downloaded file contents, shared across repos and branches. */
export class FileBlobCache implements BlobCache {
  constructor(private readonly cacheDir: () => string) {}

  private file(key: string): string {
    const k = safe(key)
    return join(this.cacheDir(), 'blobs', k.slice(0, 2), k)
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.file(key)))
    } catch {
      return undefined
    }
  }

  set(key: string, bytes: Uint8Array): Promise<void> {
    return writeAtomic(this.file(key), bytes)
  }
}

/** Preview thumbnails as data URLs, keyed by the model's content hash. */
export class ThumbnailStore {
  constructor(private readonly cacheDir: () => string) {}

  private file(key: string): string {
    return join(this.cacheDir(), 'thumbs', `${safe(key)}.txt`)
  }

  async getMany(keys: readonly string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    await Promise.all(
      keys.map(async (k) => {
        try {
          out[k] = await readFile(this.file(k), 'utf8')
        } catch {
          // not rendered yet
        }
      })
    )
    return out
  }

  async save(key: string, dataUrl: string): Promise<void> {
    if (!/^data:image\/(png|webp|jpeg);base64,/.test(dataUrl) || dataUrl.length > 2_000_000) return
    await writeAtomic(this.file(key), dataUrl)
  }
}
