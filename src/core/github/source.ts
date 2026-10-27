import { SourceError } from '../errors'
import type { AssetSource } from '../source'
import type { RepoRef, TreeEntry } from '../types'
import type { GitHubClient } from './client'
import { isLfsPath, parseLfsAttributes, parseLfsPointer } from './lfs'

/** Stores branch trees by commit SHA; commits are immutable, so entries never go stale. */
export interface TreeCache {
  get(repo: string, commitSha: string): Promise<TreeEntry[] | undefined>
  set(repo: string, commitSha: string, entries: TreeEntry[]): Promise<void>
}

export interface GitHubSourceOptions {
  /** Which LFS entries get their real size read from the pointer (asset files only, to save requests). */
  shouldResolveLfs(entry: TreeEntry): boolean
  cache?: TreeCache
  /** Lists a commit's files with git when the Trees API response is truncated (very large repos). */
  gitFallback?(repo: string, commitSha: string): Promise<TreeEntry[]>
}

export class GitHubAssetSource implements AssetSource {
  readonly id = 'github'
  readonly isDemo = false

  constructor(
    private readonly client: GitHubClient,
    private readonly options: GitHubSourceOptions
  ) {}

  listRepos(): Promise<RepoRef[]> {
    return this.client.listRepos()
  }

  listBranches(repo: string): Promise<string[]> {
    return this.client.listBranches(repo)
  }

  async listTree(repo: string, branch: string): Promise<TreeEntry[]> {
    const commit = await this.client.getBranchHead(repo, branch)
    const cached = await this.options.cache?.get(repo, commit)
    if (cached) return cached

    let { entries, truncated } = await this.client.getTree(repo, commit)
    if (truncated) {
      if (!this.options.gitFallback) throw new SourceError('truncated', 'Repository tree is too large for the GitHub API')
      entries = await this.options.gitFallback(repo, commit)
    }

    await this.markLfs(repo, commit, entries)
    await this.options.cache?.set(repo, commit, entries)
    return entries
  }

  /** Flags LFS files from the root .gitattributes and reads real sizes from their pointers. */
  private async markLfs(repo: string, commit: string, entries: TreeEntry[]): Promise<void> {
    if (!entries.some((e) => e.path === '.gitattributes')) return
    const attributes = await this.client.getFileText(repo, commit, '.gitattributes')
    if (!attributes) return
    const rules = parseLfsAttributes(attributes)
    if (!rules.length) return

    const toResolve: TreeEntry[] = []
    for (const entry of entries) {
      if (entry.type !== 'blob' || !isLfsPath(entry.path, rules)) continue
      entry.lfs = true
      // Pointers are ~130 bytes; anything much larger was committed without LFS.
      if ((entry.size ?? 0) > 1024) entry.lfs = false
      else if (this.options.shouldResolveLfs(entry)) toResolve.push(entry)
    }
    if (!toResolve.length) return

    const texts = await this.client.getBlobTexts(repo, commit, toResolve.map((e) => e.path))
    for (const entry of toResolve) {
      const pointer = parseLfsPointer(texts.get(entry.path) ?? '')
      if (pointer) {
        entry.lfsSize = pointer.size
        entry.lfsOid = pointer.oid
      } else if (texts.has(entry.path)) {
        entry.lfs = false
      }
    }
  }
}
