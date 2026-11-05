// Publishes the build to the public release repo (package.json "releaseRepo") as GitHub release
// v<version>: the zip the web installer downloads, its SHA-256 file, and the installer itself.
// Run `npm run dist:web` first. Needs gh signed in with write access to that repo.
// The release notes are this version's section of CHANGELOG.md; there must be one.
// Every installed copy updates itself from this repo, so release only when the build is approved.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const { version, releaseRepo } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// The .zip stays for installers and app versions that only know it (0.2.1 and before); the rest is
// what newer ones prefer (scripts/make-update-files.mjs).
const files = [
  'Asset-Hub-arm64.zip',
  'Asset-Hub-arm64.zip.sha256',
  'Asset-Hub-arm64.tar.xz',
  'Asset-Hub-arm64.tar.xz.sha256',
  'Asset-Hub-arm64.delta.tar.xz',
  'Asset-Hub-arm64.manifest.json',
  'Asset-Hub-Installer.dmg'
].map((f) => join(root, 'release', f))
const missing = files.filter((f) => !existsSync(f))
if (missing.length) throw new Error(`Missing (run npm run dist:web): ${missing.join(', ')}`)

// "## [0.1.1] — date" up to the next "## [" heading.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const section = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm').exec(changelog)?.[1].trim()
if (!section) throw new Error(`CHANGELOG.md has no "## [${version}]" section: rename "Unreleased" to the version first`)
const notes = `Install: download **Asset-Hub-Installer.dmg** and run it (Apple silicon, M1–M4). Installed copies offer the update by themselves.\n\n${section}`
execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', releaseRepo, '--title', `Asset Hub ${version}`, '--notes', notes], { stdio: 'inherit' })
