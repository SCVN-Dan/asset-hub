// Makes release/Asset-Hub-Installer.dmg: just the small "Cài Asset Hub" installer, which downloads the
// newest build from the public release repo (package.json "releaseRepo"). Part of `npm run dist:web`, after
// electron-builder leaves release/Asset-Hub-arm64.zip; its SHA-256 file is written here, to publish with it.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const release = join(root, 'release')
const { releaseRepo } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const baseURL = `https://github.com/${releaseRepo}/releases/latest/download/`

const zip = 'Asset-Hub-arm64.zip'
const hash = createHash('sha256').update(readFileSync(join(release, zip))).digest('hex')
writeFileSync(join(release, `${zip}.sha256`), `${hash}  ${zip}\n`)

// The installer app, compiled from AppleScript with the repo filled in, wearing the app's icon.
const stage = join(release, 'web-installer')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const source = join(stage, 'installer.applescript')
writeFileSync(source, readFileSync(join(root, 'scripts/installer.applescript'), 'utf8').replace('{{BASE_URL}}', baseURL))
const app = join(stage, 'Cài Asset Hub.app')
execFileSync('osacompile', ['-o', app, source])
rmSync(source)
copyFileSync(join(root, 'build/icon.icns'), join(app, 'Contents/Resources/applet.icns'))
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app])

const dmg = join(release, 'Asset-Hub-Installer.dmg')
rmSync(dmg, { force: true })
execFileSync('hdiutil', ['create', '-volname', 'Cài Asset Hub', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', dmg])
rmSync(stage, { recursive: true, force: true })
console.log(`${dmg}  ${(statSync(dmg).size / 1024).toFixed(0)} KB  (downloads from ${baseURL})`)
