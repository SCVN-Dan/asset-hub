import type { RepoRef, TreeEntry } from './types'

/**
 * Where repos, branches and file trees come from. Phase 1 uses the mock
 * source; Phase 2 adds a GitHub-backed implementation behind the same interface.
 */
export interface AssetSource {
  readonly id: string
  listRepos(): Promise<RepoRef[]>
  listBranches(repo: string): Promise<string[]>
  listTree(repo: string, branch: string): Promise<TreeEntry[]>
}
