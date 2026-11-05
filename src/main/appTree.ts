// The app's own copy of scripts/appTree.mjs (main is bundled; the build scripts run as plain Node).
// appTree.test.ts checks both give the same answer.
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { lstat, readdir, readlink } from 'fs/promises'
import { join } from 'path'

export type TreeEntry = { path: string; type: 'file'; size: number; mode: number; sha256: string } | { path: string; type: 'link'; target: string }

/** What a small update or a full build is checked against: published with each release. */
export interface UpdateManifest {
  version: string
  /** Electron's version: a small update applies only on top of the same one. */
  electron: string
  files: TreeEntry[]
  /** The whole app, .tar.xz. */
  full: { name: string; sha256: string; size: number }
  /** Everything but Electron's large files (isBaseFile), .tar.xz. */
  delta: { name: string; sha256: string; size: number }
}

/** Every file and symlink under `root`, as in scripts/appTree.mjs. */
export async function appTree(root: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = []
  const walk = async (rel: string): Promise<void> => {
    for (const name of (await readdir(join(root, rel))).sort()) {
      const path = rel ? `${rel}/${name}` : name
      const full = join(root, path)
      const s = await lstat(full)
      if (s.isSymbolicLink()) out.push({ path, type: 'link', target: await readlink(full) })
      else if (s.isDirectory()) await walk(path)
      else if (s.isFile()) out.push({ path, type: 'file', size: s.size, mode: s.mode & 0o777, sha256: await fileSha256(full) })
    }
  }
  await walk('')
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function fileSha256(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', fail)
  })
}

export const BASE_MIN_BYTES = 256 * 1024
export const isBaseFile = (e: TreeEntry): boolean => e.type === 'file' && e.size >= BASE_MIN_BYTES && e.path !== 'Contents/Resources/app.asar'

/** `actual` is exactly `expected`: the same files and links, byte for byte, with the same permissions. */
export function sameTree(actual: readonly TreeEntry[], expected: readonly TreeEntry[]): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((a, i) => {
    const e = expected[i]
    if (a.path !== e.path || a.type !== e.type) return false
    return a.type === 'link' ? a.target === (e as typeof a).target : a.sha256 === (e as typeof a).sha256 && a.size === (e as typeof a).size && a.mode === (e as typeof a).mode
  })
}

/**
 * Whether the app at `bundle` already has every file a small update leaves out, as the
 * new version has them (checked by size first, then by content).
 */
export async function hasBaseFiles(bundle: string, manifest: UpdateManifest): Promise<boolean> {
  for (const e of manifest.files) {
    if (!isBaseFile(e) || e.type !== 'file') continue
    const s = await lstat(join(bundle, e.path)).catch(() => undefined)
    if (!s?.isFile() || s.size !== e.size) return false
    if ((await fileSha256(join(bundle, e.path))) !== e.sha256) return false
  }
  return true
}
