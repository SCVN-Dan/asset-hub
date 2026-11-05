// What a built Asset Hub.app is made of, file by file, for the update manifest (scripts/make-update-files.mjs)
// and for checking an app put together from a small update against it (src/main/updater.ts uses the same
// rules through src/main/appTree.ts; src/main/appTree.test.ts checks the two agree).
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Every file and symlink under `root` (directories only through them), paths relative to it with "/",
 * sorted. Files: SHA-256, size and permission bits; links: their target.
 */
export async function appTree(root) {
  const out = []
  const walk = async (rel) => {
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

export function fileSha256(file) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', fail)
  })
}

/**
 * Files a small update leaves out: Electron's large files, the same in every build on one Electron
 * version (signing ad hoc is deterministic). The app's own code (app.asar) always comes.
 */
export const BASE_MIN_BYTES = 256 * 1024
export const isBaseFile = (entry) => entry.type === 'file' && entry.size >= BASE_MIN_BYTES && entry.path !== 'Contents/Resources/app.asar'
