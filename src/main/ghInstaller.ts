import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { FetchLike } from '@core/github/client'

export interface InstalledGh {
  version: string
  path: string
}

import type { InstallProgress } from '@shared/ipc'

const RELEASES = 'https://api.github.com/repos/cli/cli/releases/latest'
const MANIFEST = 'gh.json'

/** gh installed earlier by the app, if it is still on disk. */
export async function readInstalledGh(toolsDir: string): Promise<InstalledGh | undefined> {
  try {
    const info = JSON.parse(await readFile(join(toolsDir, MANIFEST), 'utf8')) as InstalledGh
    return existsSync(info.path) ? info : undefined
  } catch {
    return undefined
  }
}

/** Release asset name for this OS/CPU, e.g. gh_2.60.0_macOS_arm64.zip. */
export function ghAssetName(version: string, platform = process.platform, arch = process.arch): string {
  const os = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'windows' : 'linux'
  const cpu = arch === 'arm64' ? 'arm64' : 'amd64'
  return `gh_${version}_${os}_${cpu}.${os === 'linux' ? 'tar.gz' : 'zip'}`
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000 }, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
  )
}

function findBinary(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const found = findBinary(full, name)
      if (found) return found
    } else if (entry === name && dir.endsWith('bin')) return full
  }
  return undefined
}

/**
 * Downloads the official GitHub CLI release for this machine into `toolsDir`,
 * verifies it against the release's SHA-256 checksums and unpacks it. No
 * package manager or admin rights needed.
 */
export async function installGh(toolsDir: string, fetchImpl: FetchLike, onProgress: (p: InstallProgress) => void): Promise<InstalledGh> {
  const releaseRes = await fetchImpl(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
  if (!releaseRes.ok) throw new Error(`Could not read the GitHub CLI release (HTTP ${releaseRes.status})`)
  const release = (await releaseRes.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }
  const version = release.tag_name.replace(/^v/, '')
  const name = ghAssetName(version)
  const asset = release.assets.find((a) => a.name === name)
  const sums = release.assets.find((a) => a.name === `gh_${version}_checksums.txt`)
  if (!asset || !sums) throw new Error(`No GitHub CLI build named ${name}`)

  const sumsRes = await fetchImpl(sums.browser_download_url)
  const expected = new RegExp(`^([0-9a-f]{64})\\s+${name.replace(/\./g, '\\.')}$`, 'm').exec(await sumsRes.text())?.[1]
  if (!expected) throw new Error('Checksum for the GitHub CLI download is missing')

  const res = (await fetchImpl(asset.browser_download_url)) as unknown as Response
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress({ stage: 'download', received, total })
  }
  const data = Buffer.concat(chunks)

  onProgress({ stage: 'verify' })
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expected) throw new Error('The GitHub CLI download failed its checksum; nothing was installed')

  onProgress({ stage: 'extract' })
  const target = join(toolsDir, `gh-${version}`)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  const archive = join(toolsDir, name)
  await writeFile(archive, data)
  try {
    if (name.endsWith('.zip')) {
      if (process.platform === 'win32')
        await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`])
      else await run('ditto', ['-x', '-k', archive, target])
    } else await run('tar', ['-xzf', archive, '-C', target])
  } finally {
    await rm(archive, { force: true })
  }

  const path = findBinary(target, process.platform === 'win32' ? 'gh.exe' : 'gh')
  if (!path) throw new Error('gh was not found in the downloaded archive')
  const info = { version, path }
  await writeFile(join(toolsDir, MANIFEST), JSON.stringify(info))
  return info
}
