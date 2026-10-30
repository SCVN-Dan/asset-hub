// Publishes the build to the public release repo (package.json "releaseRepo") as GitHub release
// v<version>: the zip the web installer downloads, its SHA-256 file, and the installer itself.
// Run `npm run dist:web` first. Needs gh signed in with write access to that repo.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const { version, releaseRepo } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const files = ['Asset-Hub-arm64.zip', 'Asset-Hub-arm64.zip.sha256', 'Asset-Hub-Installer.dmg'].map((f) => join(root, 'release', f))
const missing = files.filter((f) => !existsSync(f))
if (missing.length) throw new Error(`Missing (run npm run dist:web): ${missing.join(', ')}`)
execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', releaseRepo, '--title', `Asset Hub ${version}`, '--notes', 'Cài nhanh: tải Asset-Hub-Installer.dmg. Hướng dẫn: docs/CAI-DAT.md trong repo mã nguồn.'], { stdio: 'inherit' })
