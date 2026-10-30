import { app, net } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { access, constants, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import type { InstallProgress, UpdateInfo } from '@shared/ipc'
import { isNewer } from '@shared/version'
import { releaseRepo } from '../../package.json'

/**
 * Updates without Apple's updater (that one needs a Developer ID): the app asks
 * the public release repo for its latest version, downloads the build, checks
 * it against the SHA-256 published with it and swaps itself in Applications,
 * the way the web installer (scripts/installer.applescript) installs it.
 */
const ZIP = 'Asset-Hub-arm64.zip'
const RELEASES = `https://github.com/${releaseRepo}/releases`

/** The .app this process runs from, when it is a packaged app it may replace. */
async function ownBundle(): Promise<string | undefined> {
  if (!app.isPackaged || process.platform !== 'darwin' || process.arch !== 'arm64') return undefined
  // …/Asset Hub.app/Contents/MacOS/Asset Hub
  const bundle = resolve(process.execPath, '../../..')
  // Run from the .dmg or a quarantined download, macOS hands the app a read-only copy.
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) return undefined
  try {
    await access(dirname(bundle), constants.W_OK)
    await access(bundle, constants.W_OK)
    return bundle
  } catch {
    return undefined
  }
}

/** Where a URL redirects to (net.fetch hides it), without following it. */
function redirectOf(url: string): Promise<string | undefined> {
  return new Promise((done, fail) => {
    const req = net.request({ url, method: 'HEAD', redirect: 'manual' })
    req.on('redirect', (_status, _method, location) => {
      done(location)
      req.abort()
    })
    req.on('response', () => done(undefined))
    req.on('error', fail)
    req.end()
  })
}

/** The latest release's version: github.com/…/releases/latest redirects to …/tag/v<version> (no API rate limit). */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const latest = /\/releases\/tag\/v?([^/?#]+)$/.exec((await redirectOf(`${RELEASES}/latest`)) ?? '')?.[1]
  return {
    current,
    ...(latest && isNewer(latest, current) ? { latest } : {}),
    canInstall: (await ownBundle()) !== undefined,
    page: `${RELEASES}/latest`
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => execFile(cmd, args, { timeout: 120_000 }, (err, _out, stderr) => (err ? fail(new Error(stderr || err.message)) : done())))
}

/**
 * Downloads and verifies `version`, then quits: a small script waits for this
 * process to end, puts the new app where this one was (the old one comes back
 * if that fails) and opens it. Settings and the cache live elsewhere and stay.
 */
export async function installUpdate(version: string, onProgress: (p: InstallProgress) => void): Promise<void> {
  const bundle = await ownBundle()
  if (!bundle) throw new Error('This copy of Asset Hub cannot replace itself; run the installer again.')
  const base = `${RELEASES}/download/v${version}/`
  const work = await mkdtemp(join(tmpdir(), 'assethub-update-'))
  try {
    const sums = await net.fetch(`${base}${ZIP}.sha256`)
    const expected = sums.ok ? /^[0-9a-f]{64}/.exec(await sums.text())?.[0] : undefined
    if (!expected) throw new Error(`No checksum published for ${version}`)

    const res = await net.fetch(`${base}${ZIP}`)
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const zip = join(work, ZIP)
    const file = createWriteStream(zip)
    const hash = createHash('sha256')
    const reader = res.body.getReader()
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        await new Promise<void>((ok, fail) => file.write(value, (err) => (err ? fail(err) : ok())))
        received += value.length
        onProgress({ stage: 'download', received, total })
      }
    } finally {
      await new Promise((ok) => file.end(ok))
    }

    onProgress({ stage: 'verify' })
    if (hash.digest('hex') !== expected) throw new Error('The download failed its checksum; nothing was changed.')

    onProgress({ stage: 'extract' })
    const unpacked = join(work, 'app')
    await run('ditto', ['-x', '-k', zip, unpacked])
    const fresh = join(unpacked, 'Asset Hub.app')
    if (!existsSync(fresh)) throw new Error('Asset Hub.app was not found in the download')

    // $1 pid, $2 installed app, $3 new app, $4 work folder.
    const swap = [
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'rm -rf "$2.old"',
      'if mv "$2" "$2.old"; then',
      '  if mv "$3" "$2"; then rm -rf "$2.old"; else rm -rf "$2"; mv "$2.old" "$2"; fi',
      'fi',
      'xattr -dr com.apple.quarantine "$2" 2>/dev/null',
      'rm -rf "$4"',
      'open "$2"'
    ].join('\n')
    spawn('/bin/sh', ['-c', swap, 'swap', String(process.pid), bundle, fresh, work], { detached: true, stdio: 'ignore' }).unref()
  } catch (err) {
    await rm(work, { recursive: true, force: true })
    throw err
  }
  app.quit()
}
