import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { SourceError, type TreeEntry } from '@core/index'

function git(args: string[], env: NodeJS.ProcessEnv, cwd?: string, input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env })
    const out: Buffer[] = []
    let err = ''
    const timer = setTimeout(() => child.kill(), 10 * 60_000)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new SourceError('unknown', e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new SourceError('unknown', err.trim() || `git exited with ${code}`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

let gitUsable: Promise<boolean> | undefined

/**
 * True when a real git is installed. On macOS /usr/bin/git is a stub until the
 * Command Line Tools are installed, and calling it pops an install dialog — so
 * check xcode-select first and never touch the stub.
 */
export function hasGit(): Promise<boolean> {
  gitUsable ??= new Promise((resolve) => {
    const check = () => execFile('git', ['--version'], { timeout: 10_000 }, (err) => resolve(!err))
    if (process.platform === 'darwin') execFile('xcode-select', ['-p'], { timeout: 10_000 }, (err) => (err ? resolve(false) : check()))
    else check()
  })
  return gitUsable
}

/** Token passed through GIT_CONFIG_* env vars so it never appears in argv. */
function gitEnv(token: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
  }
}

/** Git work on one cache repo runs one command chain at a time (config and fetch take locks). */
const repoQueues = new Map<string, Promise<unknown>>()
function serially<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const next = (repoQueues.get(dir) ?? Promise.resolve()).catch(() => undefined).then(task)
  repoQueues.set(dir, next.catch(() => undefined))
  return next
}

/** Bare partial-clone cache repo: objects are fetched on demand, nothing is checked out. */
const repoDir = (cacheDir: string, repo: string) => join(cacheDir, 'repos', `${repo.replace('/', '__')}.git`)

async function ensureRepo(cacheDir: string, repo: string, env: NodeJS.ProcessEnv): Promise<string> {
  const dir = repoDir(cacheDir, repo)
  if (!existsSync(join(dir, 'config'))) {
    await mkdir(dir, { recursive: true })
    await git(['init', '--bare', '--quiet'], env, dir)
  }
  // (Re)applied every time so caches made by older versions get the promisor settings.
  await git(['config', 'remote.origin.url', `https://github.com/${repo}.git`], env, dir)
  await git(['config', 'remote.origin.promisor', 'true'], env, dir)
  await git(['config', 'remote.origin.partialclonefilter', 'blob:none'], env, dir)
  return dir
}

/** Splits `git cat-file --batch` output into object id → contents. */
export function parseCatFileBatch(out: Buffer): Map<string, Buffer> {
  const objects = new Map<string, Buffer>()
  let pos = 0
  while (pos < out.length) {
    const nl = out.indexOf(10, pos)
    if (nl === -1) break
    const [oid, type, size] = out.subarray(pos, nl).toString().split(' ')
    pos = nl + 1
    if (type === 'missing' || size === undefined) continue
    const len = Number(size)
    objects.set(oid, out.subarray(pos, pos + len))
    pos += len + 1 // contents are followed by a newline
  }
  return objects
}

/**
 * Downloads many blobs in one `git fetch` (a single pack) and reads them back.
 * Several times faster than the API for thousands of small files.
 */
export async function readBlobsWithGit(cacheDir: string, repo: string, oids: readonly string[], token: string): Promise<Map<string, Buffer>> {
  const env = gitEnv(token)
  return serially(repoDir(cacheDir, repo), () => readBlobsLocked(cacheDir, repo, oids, env))
}

async function readBlobsLocked(cacheDir: string, repo: string, oids: readonly string[], env: NodeJS.ProcessEnv): Promise<Map<string, Buffer>> {
  const dir = await ensureRepo(cacheDir, repo, env)
  // In a partial clone, asking for a missing object makes git fetch it on its
  // own, one request each. Only ever ask for objects already on disk.
  const local = async () =>
    new Set((await git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'], env, dir)).toString().split('\n').filter(Boolean))
  const before = await local()
  const missing = oids.filter((o) => !before.has(o))
  if (missing.length) await git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--filter=blob:none', 'origin', '--stdin'], env, dir, missing.join('\n') + '\n')
  const have = await local()
  const wanted = oids.filter((o) => have.has(o))
  return wanted.length ? parseCatFileBatch(await git(['cat-file', '--batch'], env, dir, wanted.join('\n') + '\n')) : new Map()
}

/**
 * Lists every file of a commit with git — used when the Trees API truncates
 * very large repos. Fetches only trees (no file contents).
 */
export async function listTreeWithGit(cacheDir: string, repo: string, commitSha: string, token: string): Promise<TreeEntry[]> {
  const env = gitEnv(token)
  const out = await serially(repoDir(cacheDir, repo), async () => {
    const dir = await ensureRepo(cacheDir, repo, env)
    await git(['fetch', '--quiet', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', commitSha], env, dir)
    // -z: paths are NUL-separated and not C-quoted, so non-ASCII names stay intact.
    return (await git(['ls-tree', '-r', '-t', '-z', commitSha], env, dir)).toString()
  })
  const entries: TreeEntry[] = []
  for (const line of out.split('\0')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const [, type, sha] = line.slice(0, tab).split(' ')
    if (type !== 'blob' && type !== 'tree') continue
    // Sizes are unknown without downloading blobs; they are filled in when an asset is fetched.
    entries.push({ path: line.slice(tab + 1), type, sha })
  }
  return entries
}
