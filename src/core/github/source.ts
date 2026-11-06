import { closestPath, describeMaterials, type DepContext, type GuidKind } from '../deps/fbx'
import type { DependencyReport, PrefabMaterialsResult, PrefabScope, PrefabUsage } from '../deps/types'
import { SourceError } from '../errors'
import { baseName } from '../registry'
import type { AssetSource } from '../source'
import type { AssetTypeHandler, RepoRef, TreeEntry } from '../types'
import { isInExcludedFolder } from '../unity'
import { folderAffinity, modelMaterials } from '../unity/prefab'
import { effectShas, prefabEffectFact } from '../unity/particles'
import { isTmpFontAsset } from '../unity/tmpFont'
import type { FactKind } from '../types'
import { metaGuid } from '../unity/yaml'
import type { BranchHead, GitHubClient } from './client'
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
  /** Same, for background catalog scans: must not hold up `gitFallback` work. */
  backgroundGitFallback?(repo: string, commitSha: string): Promise<TreeEntry[]>
  /** Fast path for many small blobs at once (e.g. one git fetch); falls back to GraphQL when absent or failing. */
  readBlobsBulk?(repo: string, oids: readonly string[]): Promise<Map<string, Uint8Array>>
  /**
   * Downloads these blobs ahead in one go (one git fetch), so reading them in chunks
   * afterwards is local. Each fetch costs seconds whatever its size: 3,000 prefabs
   * take about 11 s in one fetch and about 3 minutes in 35.
   */
  prefetchBlobs?(repo: string, oids: readonly string[]): Promise<void>
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
  /** On-demand GUID lookups while the full index is not built yet. */
  lazy?: LazyGuids
  /** On-demand lookups for models, prefabs, scripts and other assets, which the GUID index leaves out. */
  extra?: LazyGuids
}

/** Timing lines for ASSETHUB_TRACE=1 runs. */
const trace = (line: string) => {
  if (typeof process !== 'undefined' && process.env?.ASSETHUB_TRACE) console.log(`[src] ${line}`)
}

/** .meta files of each kind, for lookups that only need one kind. */
const KIND_PATTERN: Record<GuidKind, RegExp> = {
  material: /\.mat\.meta$/i,
  texture: /\.(png|jpe?g|tga|psd|psb|tiff?|exr|bmp|gif|hdr|cubemap|rendertexture)\.meta$/i,
  // Any extension ending in "shader" too: custom shader importers (Toony Colors Pro's .tcp2shader…).
  shader: /\.(shader|shadergraph|shadersubgraph|[a-z0-9]+shader|hlsl|cginc)\.meta$/i,
  any: /\.meta$/i,
  model: /\.(fbx|obj|blend|dae|3ds|max|ma|mb|asset|mesh)\.meta$/i,
  prefab: /\.(prefab|fbx|obj|blend)\.meta$/i,
  script: /\.(cs|dll)\.meta$/i,
  other: /\.(wav|mp3|ogg|aiff?|anim|controller|overridecontroller|asset|ttf|otf|fontsettings|mask|physicmaterial|physicsmaterial2d|playable|signal|spriteatlas|spriteatlasv2|mixer|cubemap|flare|guiskin|renderTexture|lighting|terrainlayer)\.meta$/i
}
const EXTRA_KINDS = new Set<GuidKind>(['model', 'prefab', 'script', 'other'])
/** .meta files of the extra kinds (outside INDEXED). */
const EXTRA_META = new RegExp(['model', 'prefab', 'script', 'other'].map((k) => KIND_PATTERN[k as GuidKind].source).join('|'), 'i')
/** .meta files read by one quick lookup before it gives up and leaves the rest to the full index. */
const LOOKUP_BUDGET = 640
/** One GraphQL request reads 40 files in about a second; four run side by side. */
const LOOKUP_CHUNK = 160
const LOOKUP_PARALLEL = 4

/**
 * GUID → path answered on demand: GUIDs whose .meta was read before (on any
 * branch) are known at once; for the others, .meta files of the expected kind
 * are read nearest-folder-first, a chunk at a time, until they are found.
 */
class LazyGuids {
  readonly known = new Map<string, string>()
  private unread: TreeEntry[]
  /** One lookup per kind reads at a time, so two never fetch the same files; kinds read in parallel. */
  private readonly locks = new Map<GuidKind, Promise<unknown>>()

  constructor(
    metas: readonly TreeEntry[],
    private readonly bySha: Record<string, string>,
    private readonly read: (entries: readonly TreeEntry[]) => Promise<Map<string, string>>
  ) {
    this.unread = []
    for (const m of metas) {
      const guid = bySha[m.sha]
      if (guid === undefined) this.unread.push(m)
      else if (guid) this.known.set(guid, m.path.slice(0, -'.meta'.length))
    }
  }

  /** Every .meta read: a GUID not known now is not in the commit. */
  get complete(): boolean {
    return this.unread.length === 0
  }

  /**
   * Reads .meta files of `kind` until every GUID is known or the budget runs
   * out: files named like `hints` first (an FBX names its materials), then
   * the folders nearest the model.
   */
  find(guids: readonly string[], kind: GuidKind, nearPath: string, hints: readonly string[] = [], limit = LOOKUP_BUDGET): Promise<void> {
    const wanted = () => [...new Set(guids)].filter((g) => !this.known.has(g))
    if (!wanted().length || this.complete) return Promise.resolve()
    const run = (this.locks.get(kind) ?? Promise.resolve()).then(async () => {
      trace(`guid lookup ${kind}: ${wanted().length} wanted, ${this.unread.length} unread`)
      const near = nearPath.split('/')
      const affinity = (p: string) => {
        const parts = p.split('/')
        let i = 0
        while (i < near.length && i < parts.length && near[i] === parts[i]) i++
        return i
      }
      const named = new Set(hints.map((h) => h.toLowerCase()))
      const stem = (p: string) => baseName(p).replace(/\.meta$/i, '').replace(/\.[^.]+$/, '').toLowerCase()
      const candidates = this.unread
        .filter((m) => KIND_PATTERN[kind].test(m.path))
        .map((m) => ({ m, score: (named.has(stem(m.path)) ? 1000 : 0) + affinity(m.path) }))
        .sort((a, b) => b.score - a.score)
        .map((c) => c.m)
      let budget = limit
      for (let i = 0; i < candidates.length && budget > 0 && wanted().length; ) {
        const chunk = candidates.slice(i, i + Math.min(LOOKUP_CHUNK, budget))
        i += chunk.length
        budget -= chunk.length
        const started = Date.now()
        const texts = await this.read(chunk)
        for (const m of chunk) {
          const text = texts.get(m.sha)
          if (text === undefined) continue
          const guid = metaGuid(text) ?? ''
          this.bySha[m.sha] = guid
          if (guid) this.known.set(guid, m.path.slice(0, -'.meta'.length))
        }
        trace(`guid lookup ${kind}: read ${chunk.length} .meta (${texts.size} ok) in ${Date.now() - started}ms, ${wanted().length} still wanted`)
        const read = new Set(chunk.filter((m) => texts.has(m.sha)).map((m) => m.sha))
        this.unread = this.unread.filter((m) => !read.has(m.sha))
      }
    })
    this.locks.set(kind, run.catch(() => undefined))
    return run
  }
}

/** .meta files worth indexing: anything a model, material or shader can reference. */
// Models are left out: their .meta files are large and nothing a material uses points at them.
const INDEXED = /\.(mat|png|jpe?g|tga|psd|psb|tiff?|exr|bmp|gif|hdr|cubemap|rendertexture|shader|shadergraph|shadersubgraph|[a-z0-9]+shader|hlsl|cginc)\.meta$/i
/** Marks a commit's stored GUID index as built with the current INDEXED; older ones are rebuilt (cheaply: read .meta files are kept by SHA). */
const INDEX_FORMAT_KEY = '#format'
const INDEX_FORMAT = '2'
const INDEX_CONCURRENCY = 6
const INDEX_BATCH = 120
/** Meta blob SHA → GUID ('' when the file has none), shared by every commit and branch of a repo. */
const SHA_KIND = 'metaguids'
const SHA_KEY = 'by-sha'
/** Prefab blob SHA → model GUID → material GUIDs. */
const PREFAB_KIND = 'prefabmodels'
/** Prefab blob SHA → particle facts (see `prefabEffectFact`); v3: models with an effect attached are not effects. */
const EFFECT_KIND = 'prefabfx3'
/** Texture .meta blob SHA → '1' when imported as a sprite. */
const SPRITE_KIND = 'spritemeta'
/** .asset blob SHA → '1' when it is a TextMeshPro font asset. */
const TMP_KIND = 'tmpfont'
/** Facts by blob SHA worth sharing with a team: the same blob gives the same fact on every machine. */
export const SHARED_FACT_KINDS = [SHA_KIND, PREFAB_KIND, EFFECT_KIND, SPRITE_KIND, TMP_KIND] as const
/** Textures whose .meta can say "sprite". */
const SPRITE_TEXTURE = /\.(png|jpe?g|tga|psd|gif|bmp|tiff?)$/i
/**
 * .asset files worth reading for TextMeshPro fonts: TextMeshPro names them "<Font> SDF" and keeps them
 * under Fonts folders. Other .asset files can be huge (terrain data), so they are not read.
 */
const TMP_CANDIDATE = /(sdf|font)[^/]*\.asset$|\/fonts?[^/]*\/[^/]*\.asset$/i

/** Bytes of prefabs read by a "nearby" search before it stops. */
const NEAR_BUDGET = 16 * 1024 * 1024
/** Bytes per bulk read, so progress can move during a big scan. */
const PREFAB_CHUNK = 24 * 1024 * 1024
/** Smaller steps for nearby searches, so they can stop as soon as the model is found. */
const NEAR_CHUNK = 6 * 1024 * 1024

export class GitHubAssetSource implements AssetSource {
  readonly id = 'github'
  private readonly snapshots = new Map<string, Snapshot>()
  /** GUID index builds in flight, per repo@commit: concurrent callers share one build and its progress. */
  private readonly guidBuilds = new Map<string, { promise: Promise<Map<string, string>>; listeners: Set<(p: IndexProgress) => void> }>()
  /** File downloads in flight, per content key, so two callers never fetch the same blob twice. */
  private readonly reads = new Map<string, Promise<Uint8Array>>()
  /** .gitattributes texts by blob SHA. */
  private readonly attributes = new Map<string, Promise<string>>()
  /**
   * Per-repo caches loaded once and shared by every caller. Each search adds to
   * the same object, so concurrent searches can no longer overwrite each other.
   */
  private readonly shared = new Map<string, Promise<Record<string, unknown>>>()

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

  /** Branches with their tip commits and dates, for the catalog. */
  listBranchHeads(repo: string): Promise<BranchHead[]> {
    return this.client.listBranchHeads(repo)
  }

  /**
   * A watched branch: its tip, and the files added since `seen` (a commit noted earlier).
   * Without `seen`, or when it is gone (history rewritten), nothing counts as new.
   */
  async addedSince(repo: string, branch: string, seen: string): Promise<{ head: string; added: Array<{ path: string; sha: string }>; more: boolean }> {
    const head = await this.client.getBranchHead(repo, branch)
    if (!seen || seen === head) return { head, added: [], more: false }
    try {
      const { files, more } = await this.client.compareCommits(repo, seen, head)
      // Added only: a file moved or renamed is not a new asset.
      return { head, added: files.filter((f) => f.status === 'added').map(({ path, sha }) => ({ path, sha })), more }
    } catch {
      return { head, added: [], more: false }
    }
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

  /**
   * Asset files of a commit, for the cross-branch catalog. Uses the tree cache
   * when the branch was browsed, but never stores whole trees: a catalog scan
   * walks every branch and would fill the disk.
   */
  async assetEntriesAt(repo: string, commit: string, isAsset: (entry: TreeEntry) => boolean): Promise<TreeEntry[]> {
    let entries = await this.options.cache?.get<TreeEntry[]>('tree', repo, commit)
    if (!entries) {
      const tree = await this.client.getTree(repo, commit)
      entries = tree.entries
      if (tree.truncated) {
        const fallback = this.options.backgroundGitFallback ?? this.options.gitFallback
        if (!fallback) throw new SourceError('truncated', 'Repository tree is too large for the GitHub API')
        entries = await fallback(repo, commit)
      }
      // Flags LFS files without reading their pointers (one request per file); their size stays unknown.
      await this.markLfs(repo, commit, entries, false)
    }
    return entries.filter((e) => e.type === 'blob' && isAsset(e))
  }

  /**
   * Contents of a file on the branch, from the blob cache when possible.
   * `keep: false` reads what is cached but does not add to it (files only passed on, as by an export).
   */
  async readFile(repo: string, branch: string, path: string, { keep = true }: { keep?: boolean } = {}): Promise<Uint8Array> {
    const snap = await this.snapshot(repo, branch)
    const entry = snap.byPath.get(path)
    if (!entry || entry.type !== 'blob') throw new SourceError('notFound', `${path} is not in ${repo}@${branch}`)
    return this.readEntry(repo, entry, keep)
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
  /**
   * Dependencies of one asset. `quick` answers from the .meta files nearest the
   * model when the branch's GUID index is not built yet (seconds instead of
   * a full index); the report is then `partial` and `full` gives the final one.
   */
  async resolve(
    repo: string,
    branch: string,
    path: string,
    root: string,
    onProgress?: (p: IndexProgress) => void,
    mode: 'instant' | 'quick' | 'full' = 'full'
  ): Promise<DependencyReport> {
    const snap = await this.snapshot(repo, branch)
    const entry = snap.byPath.get(path)
    const handler = entry && this.options.handlerFor?.(entry)
    if (!entry || !handler?.resolveDependencies) throw new SourceError('notFound', `No dependency resolver for ${path}`)
    if (handler.usesGuids === false) return handler.resolveDependencies(path, this.depContext(repo, snap, root, new Map()))
    if (mode !== 'full' && !snap.guids) {
      const ctx = await this.quickContext(repo, snap, root, path)
      if (ctx) {
        // `instant` answers with GUIDs already known only; the rest shows as still being checked.
        const report = await handler.resolveDependencies(path, await this.withExtra(repo, snap, mode === 'instant' ? { ...ctx, prepare: undefined } : ctx, path, mode))
        if (mode !== 'instant') await this.saveLearned(repo)
        return report
      }
    }
    const guids = await this.guidIndex(repo, snap, onProgress)
    const report = await handler.resolveDependencies(path, await this.withExtra(repo, snap, this.depContext(repo, snap, root, guids), path, mode))
    if (mode !== 'instant' && snap.extra) await this.saveLearned(repo)
    return report
  }

  /**
   * Adds lookups for the kinds the GUID index leaves out (models, prefabs,
   * scripts…): nearest folders first within a budget, or every file of that
   * kind for the `full` answer. `instant` only uses what is known already.
   */
  private async withExtra(repo: string, snap: Snapshot, ctx: DepContext, nearPath: string, mode: 'instant' | 'quick' | 'full'): Promise<DepContext> {
    if (!snap.extra) {
      const bySha = (await this.sharedCache(SHA_KIND, repo)) as Record<string, string>
      const all = snap.entries.filter((e) => e.type === 'blob' && EXTRA_META.test(e.path) && !INDEXED.test(e.path))
      let warmed: Promise<void> | undefined
      snap.extra = new LazyGuids(all, bySha, async (entries) => {
        // A search through many of them (a GUID not found nearby) goes through every model's .meta,
        // 160 at a time: each its own git fetch of about 3.5 s, and several searches at once read the
        // same ones. Downloaded once, together, the first time; every read after that is local.
        if (entries.length >= 100) await (warmed ??= this.prefetch(repo, all.filter((e) => !(e.sha in bySha))))
        return this.readManyTexts(repo, snap, entries, new TextDecoder())
      })
    }
    const extra = snap.extra
    const asked = new Set<string>()
    return {
      ...ctx,
      pathForGuid: (guid) => ctx.pathForGuid(guid) ?? extra.known.get(guid),
      prepare: async (guids, kind, hints) => {
        if (!EXTRA_KINDS.has(kind)) return ctx.prepare?.(guids, kind, hints)
        guids.forEach((g) => asked.add(g))
        if (mode !== 'instant') await extra.find(guids, kind, nearPath, hints, mode === 'full' ? Infinity : LOOKUP_BUDGET)
      },
      // After a full search an extra GUID that is still unknown is not in the branch (a package script, a deleted file).
      unsure: (guid) => (asked.has(guid) ? mode !== 'full' && !extra.complete && !extra.known.has(guid) : (ctx.unsure?.(guid) ?? false))
    }
  }

  /**
   * Starts building the branch's GUID index in the background (when it is not
   * cached), so dependencies of the next model opened are answered at once.
   */
  async warmGuidIndex(repo: string, branch: string): Promise<void> {
    const snap = await this.snapshot(repo, branch)
    if (snap.guids) return
    await this.guidIndex(repo, snap)
  }

  /** A context that looks GUIDs up on demand; undefined when the full index is cached and cheaper. */
  private async quickContext(repo: string, snap: Snapshot, root: string, nearPath: string): Promise<DepContext | undefined> {
    if ((await this.options.cache?.get<Record<string, string>>('guids', repo, snap.commit))?.[INDEX_FORMAT_KEY] === INDEX_FORMAT) return undefined
    if (!snap.lazy) {
      const bySha = (await this.sharedCache(SHA_KIND, repo)) as Record<string, string>
      snap.lazy = new LazyGuids(
        snap.entries.filter((e) => e.type === 'blob' && INDEXED.test(e.path)),
        bySha,
        // Small reads: GraphQL answers in about a second, a git fetch costs several seconds each time.
        async (entries) => {
          const size = Math.ceil(entries.length / LOOKUP_PARALLEL)
          const slices = Array.from({ length: LOOKUP_PARALLEL }, (_, i) => entries.slice(i * size, (i + 1) * size)).filter((p) => p.length)
          const parts = await Promise.all(slices.map((part) => this.client.getBlobTexts(repo, snap.commit, part.map((e) => e.path))))
          const texts = new Map(parts.flatMap((m) => [...m]))
          return new Map(entries.flatMap((e) => (texts.has(e.path) ? [[e.sha, texts.get(e.path)!] as const] : [])))
        }
      )
    }
    const lazy = snap.lazy
    return {
      ...this.depContext(repo, snap, root, lazy.known),
      prepare: (guids, kind, hints) => lazy.find(guids, kind, nearPath, hints),
      unsure: (guid) => !lazy.complete && !lazy.known.has(guid)
    }
  }

  /** Stores GUIDs learned by quick lookups, so other branches and launches reuse them. */
  private async saveLearned(repo: string): Promise<void> {
    const bySha = await this.sharedCache(SHA_KIND, repo)
    await this.options.cache?.set(SHA_KIND, repo, SHA_KEY, bySha).catch(() => {})
  }

  /**
   * Assets of the branch that tabs list by what is inside them, as blob SHAs:
   * effect prefabs, textures imported as sprites, TextMeshPro fonts. Each file
   * is read once per repo — facts are kept by SHA, shared by all branches —
   * so later calls answer at once. `found` reports them as they are read.
   */
  async knownAssets(repo: string, branch: string, kind: FactKind, onProgress?: (p: IndexProgress & { found?: string[] }) => void): Promise<string[]> {
    const snap = await this.snapshot(repo, branch)
    const blobs = snap.entries.filter((e) => e.type === 'blob')
    if (kind === 'effects') return this.effectPrefabs(repo, snap, blobs, onProgress)
    if (kind === 'tmpFonts') {
      const candidates = blobs.filter((e) => TMP_CANDIDATE.test(e.path))
      const facts = await this.scanFacts(repo, snap, TMP_KIND, candidates, (t) => (isTmpFontAsset(t) ? '1' : ''), (list, f) => list.filter((e) => f[e.sha] === '1').map((e) => e.sha), onProgress)
      return candidates.filter((e) => facts[e.sha] === '1').map((e) => e.sha)
    }
    // Sprites: the texture's .meta says so; the texture's own SHA is what the grid knows.
    const textures = blobs.filter((e) => SPRITE_TEXTURE.test(e.path))
    const metaOf = new Map(textures.flatMap((e) => (snap.byPath.has(`${e.path}.meta`) ? [[e, snap.byPath.get(`${e.path}.meta`)!] as const] : [])))
    const texturesOf = new Map<string, string[]>()
    for (const [tex, meta] of metaOf) texturesOf.set(meta.sha, [...(texturesOf.get(meta.sha) ?? []), tex.sha])
    const sprites = (list: readonly TreeEntry[], f: Record<string, string>) => list.flatMap((m) => (f[m.sha] === '1' ? (texturesOf.get(m.sha) ?? []) : []))
    const facts = await this.scanFacts(repo, snap, SPRITE_KIND, [...metaOf.values()], (t) => (/^\s*textureType: 8\b/m.test(t) ? '1' : ''), sprites, onProgress)
    return [...new Set(sprites([...metaOf.values()], facts))]
  }

  /**
   * Reads files not seen before (by SHA, per repo) in chunks and keeps one
   * fact per file. `found` turns a list of files into the SHAs to report.
   */
  private async scanFacts(
    repo: string,
    snap: Snapshot,
    kind: string,
    entries: readonly TreeEntry[],
    fact: (text: string) => string,
    found: (list: readonly TreeEntry[], facts: Record<string, string>) => string[],
    onProgress?: (p: IndexProgress & { found?: string[] }) => void
  ): Promise<Record<string, string>> {
    const facts = (await this.sharedCache(kind, repo)) as Record<string, string>
    const todo = [...new Map(entries.filter((e) => !(e.sha in facts)).map((e) => [e.sha, e])).values()]
    const total = todo.reduce((s, e) => s + (e.size ?? 0), 0)
    let done = 0
    // What earlier scans found shows at once; the rest as each chunk is read.
    onProgress?.({ done, total, found: found(entries, facts) })
    const dec = new TextDecoder()
    for (let i = 0, chunks = 0; i < todo.length; chunks++) {
      // The first chunk is read on its own, so results show within seconds; the rest is downloaded in one go.
      if (chunks === 1) await this.prefetch(repo, todo.slice(i))
      const chunk: TreeEntry[] = []
      for (let bytes = 0; i < todo.length && (bytes === 0 || bytes < PREFAB_CHUNK); i++) {
        chunk.push(todo[i])
        bytes += todo[i].size ?? 0
      }
      const texts = await this.readManyTexts(repo, snap, chunk, dec)
      // Not read: left for the next call, never remembered as "no".
      for (const e of chunk) if (texts.has(e.sha)) facts[e.sha] = fact(texts.get(e.sha)!)
      done += chunk.reduce((s, e) => s + (e.size ?? 0), 0)
      onProgress?.({ done, total, found: found(chunk, facts) })
      await this.options.cache?.set(kind, repo, SHA_KEY, facts)
    }
    return facts
  }

  /** Effect prefabs: their own particle systems, or variants of one (see `prefabEffectFact`). */
  private async effectPrefabs(repo: string, snap: Snapshot, blobs: readonly TreeEntry[], onProgress?: (p: IndexProgress & { found?: string[] }) => void): Promise<string[]> {
    const prefabs = blobs.filter((e) => /\.prefab$/i.test(e.path))
    // Variants are known to be effects only at the end, once their base is.
    const own = (list: readonly TreeEntry[], f: Record<string, string>) => [...new Set(list.filter((e) => f[e.sha] === '1').map((e) => e.sha))]
    const facts = await this.scanFacts(repo, snap, EFFECT_KIND, prefabs, prefabEffectFact, own, onProgress)
    const dec = new TextDecoder()

    // Variants name their base prefab by GUID: the .meta files say which GUID each prefab has.
    const nests = prefabs.some((e) => facts[e.sha] && facts[e.sha] !== '1')
    const guidToSha = new Map<string, string>()
    if (nests) {
      const metas = prefabs.flatMap((e) => snap.byPath.get(`${e.path}.meta`) ?? [])
      const bySha = (await this.sharedCache(SHA_KIND, repo)) as Record<string, string>
      const unread = metas.filter((m) => !(m.sha in bySha))
      if (unread.length) {
        const texts = await this.readManyTexts(repo, snap, unread, dec)
        for (const m of unread) if (texts.has(m.sha)) bySha[m.sha] = metaGuid(texts.get(m.sha)!) ?? ''
        await this.options.cache?.set(SHA_KIND, repo, SHA_KEY, bySha)
      }
      for (const e of prefabs) {
        const guid = bySha[snap.byPath.get(`${e.path}.meta`)?.sha ?? '']
        if (guid) guidToSha.set(guid, e.sha)
      }
    }
    const known = new Map(prefabs.flatMap((e) => (e.sha in facts ? [[e.sha, facts[e.sha]] as const] : [])))
    return [...effectShas(known, guidToSha)]
  }

  /**
   * Materials that prefabs put on this model — for FBX files whose materials
   * are assigned on prefabs instead. `near` reads only prefabs in related
   * folders (a few MB); `all` reads every prefab. Results are cached by prefab
   * SHA, so later searches for any model are instant for prefabs seen before.
   */
  async findPrefabMaterials(
    repo: string,
    branch: string,
    path: string,
    root: string,
    scope: PrefabScope,
    excludedFolders: readonly string[],
    onProgress?: (p: IndexProgress) => void
  ): Promise<PrefabMaterialsResult> {
    const snap = await this.snapshot(repo, branch)
    const metaText = (await this.readTexts(repo, snap, [`${path}.meta`])).get(`${path}.meta`)
    const modelGuid = metaText ? metaGuid(metaText) : undefined
    if (!modelGuid) throw new SourceError('notFound', `${path} has no .meta GUID`)

    const prefabs = snap.entries.filter(
      (e) => e.type === 'blob' && e.path.endsWith('.prefab') && e.path.startsWith(root + 'Assets/') && !isInExcludedFolder(e.path.slice(root.length), excludedFolders)
    )
    const known = (await this.sharedCache(PREFAB_KIND, repo)) as Record<string, Record<string, string[]>>
    const ranked = prefabs
      .map((e) => ({ e, score: folderAffinity(path, e.path, root) }))
      .sort((a, b) => b.score - a.score || (a.e.size ?? 0) - (b.e.size ?? 0))
    // Just which remembered prefabs use it: no material lookups, nothing downloaded.
    if (scope === 'known') {
      const unchecked = prefabs.filter((e) => !(e.sha in known))
      return {
        scope,
        prefabs: ranked.filter(({ e }) => known[e.sha]?.[modelGuid]?.length).map(({ e }) => ({ path: e.path, materials: [] })),
        scanned: prefabs.length - unchecked.length,
        remaining: unchecked.length,
        remainingBytes: unchecked.reduce((s, e) => s + (e.size ?? 0), 0),
        files: [],
        warnings: []
      }
    }
    let candidates = scope === 'cached' ? [] : ranked.filter((r) => !(r.e.sha in known))
    if (scope === 'near') {
      let budget = NEAR_BUDGET
      candidates = candidates.filter((r) => r.score > 0 && (budget -= r.e.size ?? 0) >= 0)
    }

    if (candidates.length) await this.scanPrefabs(repo, snap, candidates, known, ranked, modelGuid, scope, onProgress)
    // Materials need GUID → path only when some prefab uses the model: no index work otherwise.
    const used = ranked.some(({ e }) => known[e.sha]?.[modelGuid]?.length)
    const quick = used ? await this.quickContext(repo, snap, root, path) : undefined
    let answer = await this.prefabAnswer(repo, snap, root, quick, prefabs, ranked, known, modelGuid, scope)
    if (quick) await this.saveLearned(repo)
    // Something was not found nearby: settle it with the full index.
    if (answer.prefabs.some((p) => p.materials.some((m) => m.unsure || m.textures.some((t) => t.unsure))))
      answer = await this.prefabAnswer(repo, snap, root, undefined, prefabs, ranked, known, modelGuid, scope)
    return answer
  }

  /** Reads candidate prefabs (skipping ones another scan has read meanwhile) into the shared cache. */
  private async scanPrefabs(
    repo: string,
    snap: Snapshot,
    all: Array<{ e: TreeEntry; score: number }>,
    known: Record<string, Record<string, string[]>>,
    ranked: Array<{ e: TreeEntry; score: number }>,
    modelGuid: string,
    scope: PrefabScope,
    onProgress?: (p: IndexProgress) => void
  ): Promise<void> {
    const candidates = all.filter((r) => !(r.e.sha in known))
    const total = candidates.reduce((s, r) => s + (r.e.size ?? 0), 0)
    let done = 0
    onProgress?.({ done, total })
    const dec = new TextDecoder()
    // A nearby search stops early: it reads as it goes. The others read every candidate.
    if (scope !== 'near') await this.prefetch(repo, candidates.map((r) => r.e))
    const chunkBytes = scope === 'near' ? NEAR_CHUNK : PREFAB_CHUNK
    // Best affinity among prefabs (cached or read) that already use the model.
    let bestFound = Math.max(-1, ...ranked.filter((r) => known[r.e.sha]?.[modelGuid]?.length).map((r) => r.score))
    let read = 0
    for (let i = 0; i < candidates.length; ) {
      // Nearby search: stop once what is left is less related than a prefab already found.
      if (scope === 'near' && bestFound >= 0 && candidates[i].score < bestFound) break
      const chunk: Array<(typeof candidates)[number]> = []
      for (let bytes = 0; i < candidates.length && (bytes === 0 || bytes < chunkBytes); i++) {
        // Another search running at the same time may have read it already.
        if (candidates[i].e.sha in known) continue
        chunk.push(candidates[i])
        bytes += candidates[i].e.size ?? 0
      }
      if (!chunk.length) continue
      const texts = await this.readManyTexts(repo, snap, chunk.map((r) => r.e), dec)
      for (const r of chunk) {
        const text = texts.get(r.e.sha)
        if (text === undefined) continue // not read: leave it for a later scan
        known[r.e.sha] = modelMaterials(text)
        if (known[r.e.sha][modelGuid]?.length) bestFound = Math.max(bestFound, r.score)
      }
      read += chunk.length
      done += chunk.reduce((s, r) => s + (r.e.size ?? 0), 0)
      onProgress?.({ done, total })
    }
    if (read) await this.options.cache?.set(PREFAB_KIND, repo, SHA_KEY, known)
  }

  private async prefabAnswer(
    repo: string,
    snap: Snapshot,
    root: string,
    /** On-demand lookups; without it the full GUID index is used (and built if needed). */
    quick: DepContext | undefined,
    prefabs: TreeEntry[],
    ranked: Array<{ e: TreeEntry; score: number }>,
    known: Record<string, Record<string, string[]>>,
    modelGuid: string,
    scope: PrefabScope
  ): Promise<PrefabMaterialsResult> {
    const used = ranked.some(({ e }) => known[e.sha]?.[modelGuid]?.length)
    const ctx = quick ?? (used ? this.depContext(repo, snap, root, await this.guidIndex(repo, snap)) : undefined)
    const usages: PrefabUsage[] = []
    const files = new Set<string>()
    const warnings = new Set<PrefabMaterialsResult['warnings'][number]>()
    for (const { e } of ranked) {
      const mats = known[e.sha]?.[modelGuid]
      if (!mats?.length) continue
      const described = await describeMaterials(mats.map((guid) => ({ guid })), ctx!)
      described.files.forEach((f) => files.add(f))
      described.warnings.forEach((w) => warnings.add(w))
      usages.push({ path: e.path, materials: described.materials })
    }
    const unchecked = prefabs.filter((e) => !(e.sha in known))
    return {
      scope,
      prefabs: usages,
      scanned: prefabs.length - unchecked.length,
      remaining: unchecked.length,
      remainingBytes: unchecked.reduce((s, e) => s + (e.size ?? 0), 0),
      files: [...files],
      warnings: [...warnings]
    }
  }

  /** Facts by blob SHA of one repo (what `SHARED_FACT_KINDS` name), as kept in memory. */
  sharedFacts(kind: string, repo: string): Promise<Record<string, unknown>> {
    return this.sharedCache(kind, repo)
  }

  /**
   * Adds facts found elsewhere (a shared index) to what this app knows, in
   * the object the scans write to, so a later save keeps them. Facts already
   * known stay. Returns how many were added.
   */
  async mergeSharedFacts(kind: string, repo: string, facts: Record<string, unknown>): Promise<number> {
    const known = await this.sharedCache(kind, repo)
    let added = 0
    for (const [sha, fact] of Object.entries(facts)) {
      if (sha in known) continue
      known[sha] = fact
      added++
    }
    if (added) await this.options.cache?.set(kind, repo, SHA_KEY, known).catch(() => {})
    return added
  }

  /** One shared, lazily loaded object per cache kind and repo. */
  private sharedCache(kind: string, repo: string): Promise<Record<string, unknown>> {
    const key = `${kind}:${repo}`
    let p = this.shared.get(key)
    if (!p) {
      p = this.options.cache?.get<Record<string, unknown>>(kind, repo, SHA_KEY).then((v) => v ?? {}) ?? Promise.resolve({})
      this.shared.set(key, p)
    }
    return p
  }

  private depContext(repo: string, snap: Snapshot, root: string, guids: Map<string, string>): DepContext {
    return {
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
  }

  /** Text of many files by blob SHA: one bulk read when possible, else GraphQL. */
  /** Downloads `entries` ahead when the source can (see `prefetchBlobs`); a failure only means reading them the slow way. */
  private async prefetch(repo: string, entries: readonly TreeEntry[]): Promise<void> {
    if (!this.options.prefetchBlobs || entries.length < 2) return
    await this.options.prefetchBlobs(repo, [...new Set(entries.filter((e) => !e.lfs).map((e) => e.sha))]).catch(() => undefined)
  }

  private async readManyTexts(repo: string, snap: Snapshot, entries: readonly TreeEntry[], dec: TextDecoder): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (this.options.readBlobsBulk) {
      try {
        for (const [sha, bytes] of await this.options.readBlobsBulk(repo, entries.map((e) => e.sha))) out.set(sha, dec.decode(bytes))
        if (out.size === entries.length) return out
      } catch {
        // fall through to the API
      }
    }
    const missing = entries.filter((e) => !out.has(e.sha))
    const texts = await this.client.getBlobTexts(repo, snap.commit, missing.map((e) => e.path))
    for (const e of missing) if (texts.has(e.path)) out.set(e.sha, texts.get(e.path)!)
    return out
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

  private readEntry(repo: string, entry: TreeEntry, keep = true): Promise<Uint8Array> {
    const key = entry.lfsOid ?? entry.sha
    // A read that keeps nothing is not shared with one that should fill the cache.
    const flight = keep ? key : `${key}#pass`
    let read = this.reads.get(flight)
    if (!read) {
      read = this.downloadEntry(repo, entry, key, keep).finally(() => this.reads.delete(flight))
      this.reads.set(flight, read)
    }
    return read
  }

  private async downloadEntry(repo: string, entry: TreeEntry, key: string, keep = true): Promise<Uint8Array> {
    const cache = this.options.blobCache
    const hit = await cache?.get(key).catch(() => undefined)
    if (hit) return hit
    let bytes = await this.client.getBlobBytes(repo, entry.sha)
    // An LFS pointer is followed whatever .gitattributes says: nested Unity
    // projects often keep their own .gitattributes, which the root check misses.
    if (entry.lfs || bytes.length <= 1024) {
      const pointer = parseLfsPointer(new TextDecoder().decode(bytes))
      if (pointer) bytes = await this.client.getLfsObject(repo, pointer.oid, pointer.size)
    }
    // The cache is an optimisation: a failed write must not fail the read.
    if (keep) await cache?.set(key, bytes).catch(() => undefined)
    return bytes
  }

  /**
   * Text files of a commit (prefabs, materials, .meta…), from the blob cache
   * when read before (any branch: a blob SHA is its content), the rest in one
   * GraphQL pass, kept for next time. LFS files are not cached here: their
   * text is the pointer, and their key holds the real file.
   */
  private async readTexts(repo: string, snap: Snapshot, paths: readonly string[]): Promise<Map<string, string>> {
    const present = paths.filter((p) => snap.byPath.has(p))
    if (!present.length) return new Map()
    const cache = this.options.blobCache
    const out = new Map<string, string>()
    const todo: string[] = []
    const dec = new TextDecoder()
    await Promise.all(
      present.map(async (p) => {
        const e = snap.byPath.get(p)!
        const hit = cache && !e.lfs ? await cache.get(e.sha).catch(() => undefined) : undefined
        if (hit) out.set(p, dec.decode(hit))
        else todo.push(p)
      })
    )
    if (!todo.length) return out
    const enc = new TextEncoder()
    for (const [p, text] of await this.client.getBlobTexts(repo, snap.commit, todo)) {
      out.set(p, text)
      const e = snap.byPath.get(p)!
      // The cache is an optimisation: a failed write must not fail the read.
      if (cache && !e.lfs) void cache.set(e.sha, enc.encode(text)).catch(() => undefined)
    }
    return out
  }

  /** GUID → repo path for every indexed .meta in the commit; concurrent callers share one build. */
  private async guidIndex(repo: string, snap: Snapshot, onProgress?: (p: IndexProgress) => void): Promise<Map<string, string>> {
    if (snap.guids) return snap.guids
    const key = `${repo}@${snap.commit}`
    let build = this.guidBuilds.get(key)
    if (!build) {
      const listeners = new Set<(p: IndexProgress) => void>()
      const promise = this.buildGuidIndex(repo, snap, (p) => listeners.forEach((l) => l(p))).finally(() => this.guidBuilds.delete(key))
      build = { promise, listeners }
      this.guidBuilds.set(key, build)
    }
    if (onProgress) build.listeners.add(onProgress)
    return build.promise
  }

  private async buildGuidIndex(repo: string, snap: Snapshot, onProgress?: (p: IndexProgress) => void): Promise<Map<string, string>> {
    const cached = await this.options.cache?.get<Record<string, string>>('guids', repo, snap.commit)
    if (cached?.[INDEX_FORMAT_KEY] === INDEX_FORMAT) {
      const { [INDEX_FORMAT_KEY]: _format, ...index } = cached
      snap.guids = new Map(Object.entries(index))
      return snap.guids
    }
    const metas = snap.entries.filter((e) => e.type === 'blob' && INDEXED.test(e.path))
    // .meta files rarely change between commits and branches: only read the ones not seen before.
    const bySha = (await this.sharedCache(SHA_KIND, repo)) as Record<string, string>
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
        // Anything not returned is retried through the API below, never cached as empty.
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
          // Only what actually came back is remembered; failed reads are tried again next time.
          for (const m of batch) if (texts.has(m.path)) learn(m.sha, texts.get(m.path)!)
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
    // A commit's index is stored only when every .meta was read, so a failed read is retried next time.
    if (metas.every((m) => m.sha in bySha)) await this.options.cache?.set('guids', repo, snap.commit, { ...Object.fromEntries(guids), [INDEX_FORMAT_KEY]: INDEX_FORMAT })
    snap.guids = guids
    return guids
  }

  /** Flags LFS files from the root .gitattributes and reads real sizes from their pointers. */
  private async markLfs(repo: string, commit: string, entries: TreeEntry[], resolve = true): Promise<void> {
    const file = entries.find((e) => e.path === '.gitattributes')
    if (!file) return
    // Branches almost always share the same .gitattributes: read each version once.
    let attributes = this.attributes.get(file.sha)
    if (!attributes) {
      attributes = this.client.getFileText(repo, commit, '.gitattributes').then((t) => t ?? '')
      this.attributes.set(file.sha, attributes)
      attributes.catch(() => this.attributes.delete(file.sha))
    }
    const text = await attributes
    if (!text) return
    const rules = parseLfsAttributes(text)
    if (!rules.length) return

    const toResolve: TreeEntry[] = []
    for (const entry of entries) {
      if (entry.type !== 'blob' || !isLfsPath(entry.path, rules)) continue
      entry.lfs = true
      // Pointers are ~130 bytes; anything much larger was committed without LFS.
      if ((entry.size ?? 0) > 1024) entry.lfs = false
      else if (resolve && this.options.shouldResolveLfs(entry)) toResolve.push(entry)
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
