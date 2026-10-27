import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { SourceError, type TreeEntry } from '@core/index'

function git(args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, maxBuffer: 1 << 30, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) reject(new SourceError('unknown', (stderr || err.message).trim()))
      else resolve(stdout)
    })
  })
}

/**
 * Lists every file of a commit with git — used when the Trees API truncates
 * very large repos. Fetches only trees (no file contents) into a bare cache repo.
 * The token is passed through GIT_CONFIG_* env vars so it never appears in argv.
 */
export async function listTreeWithGit(cacheDir: string, repo: string, commitSha: string, token: string): Promise<TreeEntry[]> {
  const dir = join(cacheDir, 'repos', `${repo.replace('/', '__')}.git`)
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
  }
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
    await git(['init', '--bare', '--quiet'], env, dir)
  }
  await git(['fetch', '--quiet', '--depth=1', '--filter=blob:none', `https://github.com/${repo}.git`, commitSha], env, dir)
  const out = await git(['ls-tree', '-r', '-t', commitSha], env, dir)
  const entries: TreeEntry[] = []
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const [, type, sha] = line.slice(0, tab).split(' ')
    if (type !== 'blob' && type !== 'tree') continue
    // Sizes are unknown without downloading blobs; they are filled in when an asset is fetched.
    entries.push({ path: line.slice(tab + 1), type, sha })
  }
  return entries
}
