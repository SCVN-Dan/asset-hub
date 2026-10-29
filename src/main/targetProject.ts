import { createHash } from 'crypto'
import { access, readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { metaGuid } from '@core/index'

/** What the target project has, read from disk (never written). Paths are "Assets/…" with forward slashes. */
export interface ProjectFiles {
  root: string
  byGuid: Map<string, string>
  sizes: Map<string, number>
  bySize: Map<number, string[]>
}

const CONCURRENCY = 64

/** A folder Unity opens as a project: Assets and ProjectSettings side by side. */
export async function isUnityProject(dir: string): Promise<boolean> {
  try {
    await Promise.all([access(join(dir, 'Assets')), access(join(dir, 'ProjectSettings'))])
    return true
  } catch {
    return false
  }
}

/** Every file under Assets/ with its size, and every GUID from the .meta files. */
export async function scanProject(root: string): Promise<ProjectFiles> {
  const files: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (e) => {
        // Unity ignores hidden files and folders ending in "~".
        if (e.name.startsWith('.') || e.name.endsWith('~')) return
        const path = `${rel}/${e.name}`
        if (e.isDirectory()) await walk(path)
        else if (e.isFile()) files.push(path)
      })
    )
  }
  await walk('Assets')
  const byGuid = new Map<string, string>()
  const sizes = new Map<string, number>()
  const bySize = new Map<number, string[]>()
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const path = files[next++]
      try {
        if (path.endsWith('.meta')) {
          const guid = metaGuid(await readFile(join(root, path), 'utf8'))
          if (guid) byGuid.set(guid, path.slice(0, -'.meta'.length))
        } else {
          const size = (await stat(join(root, path))).size
          sizes.set(path, size)
          bySize.set(size, [...(bySize.get(size) ?? []), path])
        }
      } catch {
        // A file that vanished or cannot be read is simply not compared.
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { root, byGuid, sizes, bySize }
}

/** Content hash used on both sides of the comparison. */
export const contentHash = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

export async function hashProjectFile(root: string, path: string): Promise<string | undefined> {
  try {
    return contentHash(await readFile(join(root, path)))
  } catch {
    return undefined
  }
}

export async function readProjectText(root: string, path: string): Promise<string | undefined> {
  return readFile(join(root, path), 'utf8').catch(() => undefined)
}
