import { app, net } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { access, constants, mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import type { InstallProgress, UpdateInfo } from '@shared/ipc'
import { isNewer } from '@shared/version'
import { releaseRepo } from '../../package.json'
import { appTree, hasBaseFiles, sameTree, type UpdateManifest } from './appTree'

/**
 * Updates without Apple's updater (that one needs a Developer ID): the app asks
 * the public release repo for its latest version, downloads the build, checks
 * it against the SHA-256 published with it and swaps itself in Applications,
 * the way the web installer (scripts/installer.applescript) installs it.
 *
 * Releases from 0.2.2 on also publish a manifest of every file of the app
 * (scripts/make-update-files.mjs): on the same Electron version only the app's
 * own files are downloaded (about 1-2 MB) and laid over a copy of this app,
 * else the whole app as .tar.xz. Either way the result must match the manifest
 * byte for byte; anything else falls back to the .zip, as before.
 */
const ZIP = 'Asset-Hub-arm64.zip'
const MANIFEST = 'Asset-Hub-arm64.manifest.json'
const FULL = 'Asset-Hub-arm64.tar.xz'
const DELTA = 'Asset-Hub-arm64.delta.tar.xz'
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
/** Downloads `url` to `file`, reporting progress; the SHA-256 of what was written. */
async function download(url: string, file: string, onProgress: (p: InstallProgress) => void): Promise<string> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(file)
  const hash = createHash('sha256')
  const reader = res.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await new Promise<void>((ok, fail) => out.write(value, (err) => (err ? fail(err) : ok())))
      received += value.length
      onProgress({ stage: 'download', received, total })
    }
  } finally {
    await new Promise((ok) => out.end(ok))
  }
  return hash.digest('hex')
}

/** A copy of the installed app to lay a small update over: an APFS clone when possible (instant, no space). */
async function copyApp(from: string, to: string): Promise<void> {
  try {
    await run('cp', ['-cR', from, to])
  } catch {
    await rm(to, { recursive: true, force: true })
    await run('ditto', [from, to])
  }
}

/**
 * The new app through the release's manifest (0.2.2 on): a small update over a
 * copy of this app when it runs the same Electron and has its large files, else
 * the whole app as .tar.xz. Throws when the release has no manifest or anything
 * does not match it; nothing is left behind in `work` then.
 */
async function viaManifest(bundle: string, base: string, work: string, onProgress: (p: InstallProgress) => void): Promise<string> {
  const res = await net.fetch(`${base}${MANIFEST}`)
  if (!res.ok) throw new Error(`No manifest (HTTP ${res.status})`)
  const manifest = (await res.json()) as UpdateManifest
  if (!Array.isArray(manifest.files) || manifest.full?.name !== FULL || manifest.delta?.name !== DELTA) throw new Error('Unexpected manifest')
  const dir = join(work, 'manifest')
  await mkdir(dir)
  try {
    if (manifest.electron === process.versions.electron) {
      onProgress({ stage: 'verify' })
      if (await hasBaseFiles(bundle, manifest)) {
        try {
          const archive = join(dir, DELTA)
          if ((await download(`${base}${DELTA}`, archive, onProgress)) !== manifest.delta.sha256) throw new Error('Checksum')
          onProgress({ stage: 'extract' })
          const fresh = join(dir, 'delta', 'Asset Hub.app')
          await mkdir(dirname(fresh))
          await copyApp(bundle, fresh)
          await run('tar', ['-xUJf', archive, '-C', fresh])
          onProgress({ stage: 'verify' })
          if (sameTree(await appTree(fresh), manifest.files)) return fresh
        } catch {
          // The whole app instead.
        }
        await rm(join(dir, 'delta'), { recursive: true, force: true })
      }
    }
    const archive = join(dir, FULL)
    if ((await download(`${base}${FULL}`, archive, onProgress)) !== manifest.full.sha256) throw new Error('Checksum')
    onProgress({ stage: 'extract' })
    const unpacked = join(dir, 'full')
    await mkdir(unpacked)
    await run('tar', ['-xJf', archive, '-C', unpacked])
    await rm(archive, { force: true })
    const fresh = join(unpacked, 'Asset Hub.app')
    onProgress({ stage: 'verify' })
    if (!sameTree(await appTree(fresh), manifest.files)) throw new Error('The download does not match its manifest')
    return fresh
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
}

/** The new app from the release's .zip, checked against its .sha256: the way every version updates. */
async function viaZip(base: string, version: string, work: string, onProgress: (p: InstallProgress) => void): Promise<string> {
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
  return fresh
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
    const fresh = (await viaManifest(bundle, base, work, onProgress).catch(() => undefined)) ?? (await viaZip(base, version, work, onProgress))

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
