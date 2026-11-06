import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { git, gitEnv } from './gitTree'

/** The GitHub repo the team's shared index lives in (data only, written by the app). */
export const INDEX_REPO = 'SCVN-Dan/asset-hub-index'
const BRANCH = 'main'

/**
 * - `pushed`: on GitHub now.
 * - `unchanged`: nothing new to add (only the manifest's time would have changed).
 * - `behind`: someone pushed first; pull, write again (which takes in their work) and push again.
 * - `readOnly`: this account can read the repo but not write to it.
 */
export type PushResult = 'pushed' | 'unchanged' | 'behind' | 'readOnly'

/**
 * A working copy of the shared index repo. Only the latest commit is ever fetched, never
 * the history, so a machine downloads what the index holds now and, after that, only changes.
 * Pushes are never forced: git refuses one made on top of an old commit (`behind`).
 */
export class IndexRepo {
  constructor(
    readonly dir: string,
    private readonly token: () => string | undefined,
    readonly repo: string = INDEX_REPO,
    private readonly url = `https://github.com/${repo}.git`
  ) {}

  private run(args: string[]): Promise<Buffer> {
    const token = this.token()
    if (!token) return Promise.reject(new Error('Not signed in'))
    return git(args, gitEnv(token), this.dir)
  }

  /** Brings the working copy to the repo's latest commit, dropping anything not pushed. Returns that commit. */
  async pull(): Promise<string> {
    if (!existsSync(join(this.dir, '.git'))) {
      await mkdir(this.dir, { recursive: true })
      await this.run(['init', '--quiet'])
    }
    for (const [key, value] of [
      ['remote.origin.url', this.url],
      ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
      ['user.name', 'Asset Hub'],
      ['user.email', 'asset-hub@users.noreply.github.com'],
      ['core.quotepath', 'off']
    ]) {
      await this.run(['config', key, value])
    }
    await this.run(['fetch', '--quiet', '--depth', '1', 'origin', BRANCH])
    await this.run(['reset', '--quiet', '--hard', 'FETCH_HEAD'])
    await this.run(['clean', '-fdq'])
    // Commits fetched before are unreachable now: forget them at once (not after 90 days) so git's
    // own housekeeping can drop them, and the copy stays the size of the index, not of its history.
    await this.run(['reflog', 'expire', '--expire=now', '--all']).catch(() => undefined)
    await this.run(['gc', '--auto', '--quiet', '--prune=now']).catch(() => undefined)
    return (await this.run(['rev-parse', 'HEAD'])).toString().trim()
  }

  /** Files changed since the last pull. */
  async changes(): Promise<string[]> {
    const out = (await this.run(['status', '--porcelain', '-uall', '--no-renames'])).toString()
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, ''))
  }

  /** Commits what was written since the last pull and pushes it; see `PushResult`. */
  async push(message: string, ignored: readonly string[] = ['manifest.json']): Promise<PushResult> {
    const changed = await this.changes()
    if (!changed.some((p) => !ignored.includes(p))) {
      await this.discard()
      return 'unchanged'
    }
    await this.run(['add', '-A'])
    await this.run(['commit', '--quiet', '-m', message])
    try {
      await this.run(['push', '--quiet', 'origin', `HEAD:${BRANCH}`])
      return 'pushed'
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      if (/rejected|fetch first|non-fast-forward|stale info/i.test(text)) return 'behind'
      if (/\b403\b|permission|denied|not allowed/i.test(text)) return 'readOnly'
      throw err
    }
  }

  /** Throws away what was written since the last pull. */
  async discard(): Promise<void> {
    await this.run(['reset', '--quiet', '--hard'])
    await this.run(['clean', '-fdq'])
  }
}
