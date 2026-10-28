import { baseName } from '../registry'
import type { Asset, TreeEntry } from '../types'
import { isInExcludedFolder } from '../unity'

/** A branch tip as last read from GitHub. */
export interface CatalogBranch {
  name: string
  commit: string
  /** ISO date of the tip commit. */
  date?: string
}

/**
 * Asset files of every branch of one repo, as stored on disk. Branches share
 * most files, so each path and blob is kept once and commits list indexes.
 */
export interface RepoCatalogData {
  version: 1
  repo: string
  defaultBranch?: string
  /** When the branch list was last read (ms since epoch). */
  checkedAt?: number
  /** Default branch first, then most recently committed. */
  branches: CatalogBranch[]
  paths: string[]
  /** [blob SHA, size in bytes, or -1 for an LFS file whose real size is unknown]. */
  blobs: Array<[string, number]>
  /** Commit → flat [pathIndex, blobIndex, pathIndex, blobIndex, …]. */
  commits: Record<string, number[]>
  /** Commits that could not be listed (e.g. too large), with the reason. */
  failed?: Record<string, string>
}

export interface CatalogFile {
  branch: string
  path: string
  sha: string
  size?: number
  lfs: boolean
}

export class RepoCatalog {
  private readonly pathIndex = new Map<string, number>()
  private readonly blobIndex = new Map<string, number>()

  constructor(private data: RepoCatalogData) {
    this.reindex()
  }

  static empty(repo: string): RepoCatalog {
    return new RepoCatalog({ version: 1, repo, branches: [], paths: [], blobs: [], commits: {} })
  }

  /** Accepts what was read from disk; anything unexpected starts over. */
  static parse(repo: string, raw: unknown): RepoCatalog {
    const d = raw as Partial<RepoCatalogData> | undefined
    if (d?.version !== 1 || d.repo !== repo || !Array.isArray(d.paths) || !Array.isArray(d.blobs) || !d.commits || !Array.isArray(d.branches))
      return RepoCatalog.empty(repo)
    return new RepoCatalog(d as RepoCatalogData)
  }

  get repo(): string {
    return this.data.repo
  }

  get checkedAt(): number | undefined {
    return this.data.checkedAt
  }

  get defaultBranch(): string | undefined {
    return this.data.defaultBranch
  }

  get branches(): readonly CatalogBranch[] {
    return this.data.branches
  }

  /** True once the commit was listed (or found impossible to list). */
  hasCommit(commit: string): boolean {
    return commit in this.data.commits || !!this.data.failed?.[commit]
  }

  /** Branches whose current commit is not listed yet. */
  pending(): CatalogBranch[] {
    return this.data.branches.filter((b) => !this.hasCommit(b.commit))
  }

  /** Replaces the branch list; commits no branch points at any more are dropped. */
  setBranches(heads: readonly CatalogBranch[], defaultBranch: string | undefined, now = Date.now()): void {
    const branches = [...heads].sort(
      (a, b) => Number(b.name === defaultBranch) - Number(a.name === defaultBranch) || (b.date ?? '').localeCompare(a.date ?? '') || a.name.localeCompare(b.name)
    )
    const live = new Set(branches.map((b) => b.commit))
    const stale = Object.keys(this.data.commits).filter((c) => !live.has(c))
    this.data = { ...this.data, branches, defaultBranch, checkedAt: now }
    for (const c of Object.keys(this.data.failed ?? {})) if (!live.has(c)) delete this.data.failed![c]
    if (stale.length) {
      for (const c of stale) delete this.data.commits[c]
      this.compact()
    }
  }

  addCommit(commit: string, entries: readonly TreeEntry[]): void {
    const flat: number[] = []
    for (const e of entries) {
      const size = e.lfs ? (e.lfsSize ?? -1) : (e.size ?? -1)
      flat.push(this.indexOf(this.pathIndex, this.data.paths, e.path, e.path), this.indexOf(this.blobIndex, this.data.blobs, e.sha, [e.sha, size]))
    }
    this.data.commits[commit] = flat
    if (this.data.failed?.[commit]) delete this.data.failed[commit]
  }

  markFailed(commit: string, reason: string): void {
    this.data.failed = { ...this.data.failed, [commit]: reason }
  }

  /** Every asset file on every branch. */
  *files(): Generator<CatalogFile> {
    for (const branch of this.data.branches) {
      const flat = this.data.commits[branch.commit]
      if (!flat) continue
      for (let i = 0; i < flat.length; i += 2) {
        const [sha, size] = this.data.blobs[flat[i + 1]]
        yield { branch: branch.name, path: this.data.paths[flat[i]], sha, size: size < 0 ? undefined : size, lfs: size < 0 }
      }
    }
  }

  /** Branches and paths holding this blob, without walking every file. */
  locationsOf(sha: string): CatalogLocation[] {
    const blob = this.blobIndex.get(sha)
    if (blob === undefined) return []
    const byPath = new Map<number, string[]>()
    for (const branch of this.data.branches) {
      const flat = this.data.commits[branch.commit]
      if (!flat) continue
      for (let i = 1; i < flat.length; i += 2) {
        if (flat[i] !== blob) continue
        const list = byPath.get(flat[i - 1]) ?? []
        list.push(branch.name)
        byPath.set(flat[i - 1], list)
      }
    }
    return [...byPath].map(([path, branches]) => ({ repo: this.data.repo, path: this.data.paths[path], branches }))
  }

  toJSON(): RepoCatalogData {
    return this.data
  }

  private indexOf<V>(index: Map<string, number>, list: V[], key: string, value: V): number {
    let i = index.get(key)
    if (i === undefined) {
      i = list.push(value) - 1
      index.set(key, i)
    }
    return i
  }

  /** Rebuilds the path and blob tables from the commits still kept. */
  private compact(): void {
    const old = this.data
    this.data = { ...old, paths: [], blobs: [], commits: {} }
    this.pathIndex.clear()
    this.blobIndex.clear()
    for (const [commit, flat] of Object.entries(old.commits)) {
      const next: number[] = []
      for (let i = 0; i < flat.length; i += 2) {
        const path = old.paths[flat[i]]
        const blob = old.blobs[flat[i + 1]]
        next.push(this.indexOf(this.pathIndex, this.data.paths, path, path), this.indexOf(this.blobIndex, this.data.blobs, blob[0], blob))
      }
      this.data.commits[commit] = next
    }
  }

  private reindex(): void {
    this.data.paths.forEach((p, i) => this.pathIndex.set(p, i))
    this.data.blobs.forEach(([sha], i) => this.blobIndex.set(sha, i))
  }
}

/** One place an asset lives: a path in a repo, on one or more branches. */
export interface CatalogLocation {
  repo: string
  path: string
  /** Default branch first, then most recently committed. */
  branches: string[]
}

/** A file found anywhere in the catalog; identical files (same blob SHA) are one entry. */
export interface CatalogAsset extends Asset {
  locations: CatalogLocation[]
  branchCount: number
  repoCount: number
}

/** Groups every file of the catalogs by content, leaving out excluded folders and unknown types. */
export function groupCatalog(catalogs: readonly RepoCatalog[], typeOf: (path: string) => string | undefined, excludedFolders: readonly string[]): CatalogAsset[] {
  const bySha = new Map<string, CatalogAsset>()
  const locationOf = new Map<string, CatalogLocation>()
  for (const catalog of catalogs) {
    for (const file of catalog.files()) {
      if (isInExcludedFolder(file.path, excludedFolders)) continue
      let asset = bySha.get(file.sha)
      if (!asset) {
        const type = typeOf(file.path)
        if (!type) continue
        asset = { id: file.sha, type, path: file.path, name: baseName(file.path), sha: file.sha, size: file.size, lfs: file.lfs, locations: [], branchCount: 0, repoCount: 0 }
        bySha.set(file.sha, asset)
      }
      const key = `${file.sha}\n${catalog.repo}\n${file.path}`
      let location = locationOf.get(key)
      if (!location) {
        location = { repo: catalog.repo, path: file.path, branches: [] }
        locationOf.set(key, location)
        asset.locations.push(location)
      }
      location.branches.push(file.branch)
    }
  }
  for (const asset of bySha.values()) {
    asset.branchCount = new Set(asset.locations.flatMap((l) => l.branches.map((b) => `${l.repo}@${b}`))).size
    asset.repoCount = new Set(asset.locations.map((l) => l.repo)).size
    // The location on the most branches first: that is where the file "lives".
    asset.locations.sort((a, b) => b.branches.length - a.branches.length)
    asset.path = asset.locations[0].path
    asset.name = baseName(asset.path)
  }
  return [...bySha.values()]
}

/** Every place a file with this content is, across the catalogs. */
export function whereIs(catalogs: readonly RepoCatalog[], sha: string): CatalogLocation[] {
  return catalogs.flatMap((c) => c.locationsOf(sha))
}

export interface ScanTask {
  repo: string
  branch: string
  commit: string
  /** Default branch or committed in the last `recentDays`: scanned first. */
  recent: boolean
}

/** Branches still to list, recent ones (default branch, recent commits) first, newest first. */
export function planScan(catalogs: readonly RepoCatalog[], now = Date.now(), recentDays = 30): ScanTask[] {
  const cutoff = now - recentDays * 86_400_000
  const tasks: Array<ScanTask & { time: number }> = []
  for (const catalog of catalogs) {
    const seen = new Set<string>()
    for (const b of catalog.pending()) {
      // Branches at the same commit are listed once.
      if (seen.has(b.commit)) continue
      seen.add(b.commit)
      const time = b.date ? Date.parse(b.date) : 0
      tasks.push({ repo: catalog.repo, branch: b.name, commit: b.commit, recent: b.name === catalog.defaultBranch || time >= cutoff, time })
    }
  }
  tasks.sort((a, b) => Number(b.recent) - Number(a.recent) || b.time - a.time)
  return tasks.map(({ time: _time, ...task }) => task)
}
