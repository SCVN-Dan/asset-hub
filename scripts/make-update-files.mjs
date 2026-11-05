// Part of `npm run dist:web`, after electron-builder: the smaller downloads published next to the .zip
// (which stays, for installers and app versions that only know it).
//   Asset-Hub-arm64.tar.xz        the whole app, xz (about 30% smaller than the zip), and its .sha256
//   Asset-Hub-arm64.delta.tar.xz  everything but Electron's large files: an update from a copy on the same
//                                 Electron version (about 1-2 MB)
//   Asset-Hub-arm64.manifest.json every file of the app with its SHA-256, so an app put together from the
//                                 small update is checked to be exactly this build
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appTree, fileSha256, isBaseFile } from './appTree.mjs'

const root = new URL('..', import.meta.url).pathname
const release = join(root, 'release')
const appDir = join(release, 'mac-arm64')
const app = join(appDir, 'Asset Hub.app')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { version: electron } = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8'))

// macOS's own tar (bsdtar) writes and reads xz; no AppleDouble "._" files, symlinks kept as links.
const XZ = ['--no-mac-metadata', '--options', 'xz:compression-level=9', '-cJf']

const files = await appTree(app)

const full = 'Asset-Hub-arm64.tar.xz'
rmSync(join(release, full), { force: true })
execFileSync('tar', ['-C', appDir, ...XZ, join(release, full), 'Asset Hub.app'])

const delta = 'Asset-Hub-arm64.delta.tar.xz'
const list = join(release, 'delta-files.txt')
writeFileSync(list, files.filter((e) => !isBaseFile(e)).map((e) => e.path).join('\n') + '\n')
rmSync(join(release, delta), { force: true })
execFileSync('tar', ['-C', app, ...XZ, join(release, delta), '-T', list])
rmSync(list)

const described = async (name) => ({ name, sha256: await fileSha256(join(release, name)), size: statSync(join(release, name)).size })
const manifest = { version, electron, files, full: await described(full), delta: await described(delta) }
writeFileSync(join(release, `${full}.sha256`), `${manifest.full.sha256}  ${full}\n`)
writeFileSync(join(release, 'Asset-Hub-arm64.manifest.json'), JSON.stringify(manifest))

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
console.log(`${full}  ${mb(manifest.full.size)}\n${delta}  ${mb(manifest.delta.size)} (on Electron ${electron})\n${files.length} files in the manifest`)
