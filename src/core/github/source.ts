import { closestPath, type DepContext } from '../deps/fbx'
import type { DependencyReport } from '../deps/types'
import { SourceError } from '../errors'
import { baseName } from '../registry'
import type { AssetSource } from '../source'
import type { AssetTypeHandler, RepoRef, TreeEntry } from '../types'
import { metaGuid } from '../unity/yaml'
import type { GitHubClient } from './client'
import { isLfsPath, parseLfsAttributes, parseLfsPointer } from './lfs'

/** JSON values stored per repo + commit; commits are immutable, so entries never go stale. */
export interface CommitCache {
  get<T>(kind: string, repo: string, commitSha: string): Promise<T | undefined>
  set(kind: string, repo: string, commitSha: string, value: unknown): Promise<void>
}

/** File contents keyed by content hash (git blob SHA or LFS oid). */
export interface BlobCache {
  get(key: string): Promise<Uint8Array | undefined>
  set(key: string, bytes: Uint8Array): Promise<void>
}

export interface GitHubSourceOptions {
  /** Which LFS entries get their real size read from the pointer (asset files only, to save requests). */
  shouldResolveLfs(entry: TreeEntry): boolean
  /** Handler that resolves dependencies for a file, if any. */
  handlerFor?(entry: TreeEntry): AssetTypeHandler | undefined
  cache?: CommitCache
  blobCache?: BlobCache
  /** Lists a commit's files with git when the Trees API response is truncated (very large repos). */
  gitFallback?(repo: string, commitSha: string): Promise<TreeEntry[]>
  /** Fast path for many small blobs at once (e.g. one git fetch); falls back to GraphQL when absent or failing. */
  readBlobsBulk?(repo: string, oids: readonly string[]): Promise<Map<string, Uint8Array>>
}

export interface IndexProgress {
  done: number
  total: number
}

interface Snapshot {
  commit: string
  entries: TreeEntry[]
  byPath: Map<string, TreeEntry>
  byName: Map<string, string[]>
  guids?: Map<string, string>
}

/** .meta files worth indexing: anything a model, material or shader can reference. */
// Models are left out: their .meta files are large and nothing a material uses points at them.
const INDEXED = /\.(mat|png|jpe?g|tga|psd|tiff?|exr|bmp|gif|hdr|shader|shadergraph|shadersubgraph|hlsl|cginc)\.meta$/i
const INDEX_CONCURRENCY = 6
const INDEX_BATCH = 120
/** Meta blob SHA → GUID ('' when the file has none), shared by every commit and branch of a repo. */
const SHA_KIND = 'metaguids'
const SHA_KEY = 'by-sha'

export class GitHubAssetSource implements AssetSource {
  readonly id = 'github'
  readonly isDemo = false
  private readonly snapshots = new Map<string, Snapshot>()

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
    let entries = await this.options.cache?.get<TreeEntry[]>('tree', repo, commit)
    if (!entries) {
      const tree = await this.client.getTree(repo, commit)
      entries = tree.entries
      if (tree.truncated) {
        if (!this.options.gitFallback) throw new SourceError('truncated', 'Repository tree is too large for the GitHub API')
        entries = await this.options.gitFallback(repo, commit)
      }
      await this.markLfs(repo, commit, entries)
      await this.options.cache?.set('tree', repo, commit, entries)
    }
    this.remember(repo, branch, commit, entries)
    return entries
  }

  /** Contents of a file on the branch, from the blob cache when possible. */
  async readFile(repo: string, branch: string, path: string): Promise<Uint8Array> {
    const snap = await this.snapshot(repo, branch)
    const entry = snap.byPath.get(path)
    if (!entry || entry.type !== 'blob') throw new SourceError('notFound', `${path} is not in ${repo}@${branch}`)
    return this.readEntry(repo, entry)
  }

  /** Best file for each name, nearest to `nearPath`, within the Unity project's Assets. */
  async findByNames(repo: string, branch: string, names: readonly string[], nearPath: string, root: string): Promise<Record<string, string | null>> {
    const snap = await this.snapshot(repo, branch)
    const result: Record<string, string | null> = {}
    for (const name of names) {
      const candidates = (snap.byName.get(name.toLowerCase()) ?? []).filter((p) => p.startsWith(root + 'Assets/'))
      result[name] = closestPath(candidates, nearPath) ?? null
    }
    return result
  }

  /** Dependencies of one asset, via its handler. Builds the GUID index first (cached per commit). */
  async resolve(repo: string, branch: string, path: string, root: string, onProgress?: (p: IndexProgress) => void): Promise<DependencyReport> {
    const snap = await this.snapshot(repo, branch)
    const entry = snap.byPath.get(path)
    const handler = entry && this.options.handlerFor?.(entry)
    if (!entry || !handler?.resolveDependencies) throw new SourceError('notFound', `No dependency resolver for ${path}`)
    const guids = await this.guidIndex(repo, snap, onProgress)
    const ctx: DepContext = {
      root,
      byPath: snap.byPath,
      pathForGuid: (guid) => guids.get(guid),
      pathsByName: (name) => snap.byName.get(name.toLowerCase()) ?? [],
      readTexts: (paths) => this.readTexts(repo, snap, paths),
      readBytes: (p) => {
        const e = snap.byPath.get(p)
        if (!e) throw new SourceError('notFound', `${p} is not in the branch`)
        return this.readEntry(repo, e)
      }
    }
    return handler.resolveDependencies(path, ctx)
  }

  private remember(repo: string, branch: string, commit: string, entries: TreeEntry[]): Snapshot {
    const byPath = new Map<string, TreeEntry>()
    const byName = new Map<string, string[]>()
    for (const e of entries) {
      byPath.set(e.path, e)
      if (e.type !== 'blob') continue
      const key = baseName(e.path).toLowerCase()
      const list = byName.get(key)
      if (list) list.push(e.path)
      else byName.set(key, [e.path])
    }
    const previous = this.snapshots.get(`${repo}@${branch}`)
    const snap: Snapshot = { commit, entries, byPath, byName, guids: previous?.commit === commit ? previous.guids : undefined }
    this.snapshots.set(`${repo}@${branch}`, snap)
    return snap
  }

  private async snapshot(repo: string, branch: string): Promise<Snapshot> {
    const known = this.snapshots.get(`${repo}@${branch}`)
    if (known) return known
    await this.listTree(repo, branch)
    return this.snapshots.get(`${repo}@${branch}`)!
  }

  private async readEntry(repo: string, entry: TreeEntry): Promise<Uint8Array> {
    const cache = this.options.blobCache
    const key = entry.lfsOid ?? entry.sha
    const hit = await cache?.get(key)
    if (hit) return hit
    let bytes = await this.client.getBlobBytes(repo, entry.sha)
    if (entry.lfs) {
      // The blob is the pointer; the real file comes from LFS storage.
      const pointer = parseLfsPointer(new TextDecoder().decode(bytes))
      if (pointer) bytes = await this.client.getLfsObject(repo, pointer.oid, pointer.size)
    }
    await cache?.set(key, bytes)
    return bytes
  }

  private async readTexts(repo: string, snap: Snapshot, paths: readonly string[]): Promise<Map<string, string>> {
    const present = paths.filter((p) => snap.byPath.has(p))
    return present.length ? this.client.getBlobTexts(repo, snap.commit, present) : new Map()
  }

  /** GUID → repo path for every indexed .meta in the commit. */
  private async guidIndex(repo: string, snap: Snapshot, onProgress?: (p: IndexProgress) => void): Promise<Map<string, string>> {
    if (snap.guids) return snap.guids
    const cached = await this.options.cache?.get<Record<string, string>>('guids', repo, snap.commit)
    if (cached) {
      snap.guids = new Map(Object.entries(cached))
      return snap.guids
    }
    const metas = snap.entries.filter((e) => e.type === 'blob' && INDEXED.test(e.path))
    // .meta files rarely change between commits and branches: only read the ones not seen before.
    const bySha = (await this.options.cache?.get<Record<string, string>>(SHA_KIND, repo, SHA_KEY)) ?? {}
    const todo = metas.filter((m) => !(m.sha in bySha))
    let done = metas.length - todo.length
    onProgress?.({ done, total: metas.length })
    const learn = (sha: string, text: string) => {
      bySha[sha] = metaGuid(text) ?? ''
    }

    let remaining = todo
    if (remaining.length && this.options.readBlobsBulk) {
      try {
        const blobs = await this.options.readBlobsBulk(repo, [...new Set(remaining.map((m) => m.sha))])
        const dec = new TextDecoder()
        for (const [sha, bytes] of blobs) learn(sha, dec.decode(bytes))
        remaining = remaining.filter((m) => !(m.sha in bySha))
        done = metas.length - remaining.length
        onProgress?.({ done, total: metas.length })
      } catch {
        // No usable git or the fetch failed: read through the API instead.
      }
    }

    if (remaining.length) {
      const batches: TreeEntry[][] = []
      for (let i = 0; i < remaining.length; i += INDEX_BATCH) batches.push(remaining.slice(i, i + INDEX_BATCH))
      let next = 0
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++]
          const texts = await this.client.getBlobTexts(repo, snap.commit, batch.map((m) => m.path))
          for (const m of batch) learn(m.sha, texts.get(m.path) ?? '')
          done += batch.length
          onProgress?.({ done, total: metas.length })
        }
      }
      await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker))
    }

    const guids = new Map<string, string>()
    for (const m of metas) {
      const guid = bySha[m.sha]
      if (guid) guids.set(guid, m.path.slice(0, -'.meta'.length))
    }
    if (todo.length) await this.options.cache?.set(SHA_KIND, repo, SHA_KEY, bySha)
    await this.options.cache?.set('guids', repo, snap.commit, Object.fromEntries(guids))
    snap.guids = guids
    return guids
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
