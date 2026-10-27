import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TreeEntry } from '@core/index'
import type { TreeCache } from '@core/github/source'

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_')

/** Branch trees cached as JSON per commit under `<cacheDir>/trees/<owner>__<repo>/<commit>.json`. */
export class FileTreeCache implements TreeCache {
  constructor(private readonly cacheDir: () => string) {}

  private file(repo: string, commitSha: string): string {
    return join(this.cacheDir(), 'trees', safe(repo.replace('/', '__')), `${safe(commitSha)}.json`)
  }

  async get(repo: string, commitSha: string): Promise<TreeEntry[] | undefined> {
    try {
      return JSON.parse(await readFile(this.file(repo, commitSha), 'utf8')) as TreeEntry[]
    } catch {
      return undefined
    }
  }

  async set(repo: string, commitSha: string, entries: TreeEntry[]): Promise<void> {
    const file = this.file(repo, commitSha)
    await mkdir(join(file, '..'), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(entries))
    await rename(tmp, file)
  }
}
