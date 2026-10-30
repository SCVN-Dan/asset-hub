import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { chmod, mkdir, rename, rm } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { net } from 'electron'
import type { InstallProgress } from '@shared/ipc'

/**
 * The Codex build the AI assistant runs (`codex app-server`, signed in with the
 * user's ChatGPT account, no API key). Pinned: the app-server protocol changes
 * between versions, and the app speaks this one. Two programs, side by side:
 * codex itself, and the code-mode host it starts to run the model's tool calls
 * (without it every tool fails). Hashes were taken from the official release;
 * nothing is run unless both programs match.
 */
export const CODEX_VERSION = '0.165.0'
const PARTS = [
  {
    name: 'codex',
    archive: 'codex-aarch64-apple-darwin',
    bytes: 102_366_249,
    archiveSha256: '78ea9c178d2dc8fde71d6494df3b9eab902fd6d6de0a84e65234220d93bb6144',
    sha256: 'a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a'
  },
  {
    name: 'codex-code-mode-host',
    archive: 'codex-code-mode-host-aarch64-apple-darwin',
    bytes: 24_346_756,
    archiveSha256: 'd861a7dd3656e91d04d3753f2ca5624f100e37401993b299661ab6631bda8610',
    sha256: 'e723d01c65aba4b81451d486d57318232b2738889de67c35051734be917d96ba'
  }
] as const
const RELEASE = `https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/`

const managedDir = (toolsDir: string) => join(toolsDir, `codex-${CODEX_VERSION}`)

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/** A folder holding both programs, each matching its hash. Checked once per folder and process: codex is 260 MB. */
const verified = new Map<string, Promise<boolean>>()
const complete = (dir: string) => {
  if (!verified.has(dir))
    verified.set(
      dir,
      Promise.all(PARTS.map((p) => (existsSync(join(dir, p.name)) ? sha256File(join(dir, p.name)).then((h) => h === p.sha256, () => false) : false))).then((ok) => ok.every(Boolean))
    )
  return verified.get(dir)!
}

/**
 * The pinned Codex on this Mac: the app's own copy, or the very same build
 * installed by Codex itself (saves the 125 MB download). Returns the codex program.
 */
export async function findCodex(toolsDir: string): Promise<string | undefined> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return undefined
  const dirs = [managedDir(toolsDir), join(homedir(), `.codex/packages/standalone/releases/${CODEX_VERSION}-aarch64-apple-darwin/bin`)]
  for (const dir of dirs) if (await complete(dir)) return join(dir, 'codex')
  return undefined
}

/** Downloads the pinned Codex (both programs) into `toolsDir`, checking each download and program against its hash. */
export async function installCodex(toolsDir: string, onProgress: (p: InstallProgress) => void): Promise<string> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The AI assistant needs a Mac with Apple silicon')
  const dir = managedDir(toolsDir)
  const work = `${dir}.download`
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const total = PARTS.reduce((sum, p) => sum + p.bytes, 0)
  let received = 0
  try {
    for (const part of PARTS) {
      const res = await net.fetch(`${RELEASE}${part.archive}.tar.gz`)
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
      const archive = join(work, `${part.archive}.tar.gz`)
      const file = createWriteStream(archive)
      const hash = createHash('sha256')
      const reader = res.body.getReader()
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
      if (hash.digest('hex') !== part.archiveSha256) throw new Error('The Codex download failed its checksum; nothing was installed')
    }

    onProgress({ stage: 'extract' })
    for (const part of PARTS) {
      const archive = join(work, `${part.archive}.tar.gz`)
      await new Promise<void>((ok, fail) => execFile('tar', ['-xzf', archive, '-C', work], { timeout: 120_000 }, (err, _o, stderr) => (err ? fail(new Error(stderr || err.message)) : ok())))
    }
    onProgress({ stage: 'verify' })
    for (const part of PARTS) {
      const program = join(work, part.archive)
      if ((await sha256File(program)) !== part.sha256) throw new Error('A Codex program failed its checksum; nothing was installed')
      await chmod(program, 0o755)
    }
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    for (const part of PARTS) await rename(join(work, part.archive), join(dir, part.name))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  verified.delete(dir)
  return join(dir, 'codex')
}
