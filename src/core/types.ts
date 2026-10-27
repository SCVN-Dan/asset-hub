// Shared domain types. Keep this file free of DOM / Node / Electron imports so
// it can be used from both the main process (indexer) and the renderer.

/** One file or folder from a branch, shaped like GitHub's Git Trees API entries. */
export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  /** Blob SHA from git. */
  sha: string
  /** Size in bytes as stored in git (for LFS files: the pointer size unless `lfsSize` is set). */
  size?: number
  /** True when the blob is a Git LFS pointer. */
  lfs?: boolean
  /** Real object size from the LFS pointer, when known. */
  lfsSize?: number
  /** sha256 of the real object from the LFS pointer — a content hash usable for dedupe. */
  lfsOid?: string
}

/** An entry that a handler recognised as an asset of its type. */
export interface Asset {
  /** Stable id within one repo + branch: the file path. */
  id: string
  /** Handler id, e.g. 'fbx'. */
  type: string
  path: string
  name: string
  sha: string
  size?: number
  lfs: boolean
}

/** A dependency edge found by a resolver (filled in from Phase 3). */
export interface DepNode {
  guid: string
  path?: string
  kind: string
  children: DepNode[]
}

/** Per-type statistics, stored as JSON in the index (`stats_json`). */
export type AssetStats = Record<string, number | string | boolean>

export type PreviewKind = 'three' | 'audio' | 'image' | 'unity-render'

export type PreviewResult =
  | { status: 'ready'; kind: PreviewKind; url: string }
  | { status: 'unavailable'; reasonKey: string }

export interface PreviewContext {
  cacheDir: string
}

export interface PreviewProvider {
  kind: PreviewKind
  /** Always async so previews rendered elsewhere (Companion / CI) can plug in later. */
  load(asset: Asset, ctx: PreviewContext): Promise<PreviewResult>
}

export interface ResolveContext {
  /** Looks up a path by GUID in the branch index. */
  pathForGuid(guid: string): string | undefined
  readText(path: string): Promise<string>
}

export interface AssetCheckResult {
  level: 'info' | 'warning' | 'error'
  messageKey: string
  params?: Record<string, string | number>
}

export interface AssetCheck {
  id: string
  run(asset: Asset, stats: AssetStats | undefined): AssetCheckResult[]
}

export interface AssetTypeHandler {
  /** 'fbx' | 'audio' | 'sprite' | 'particle-prefab' … */
  id: string
  /** i18n key for tabs and badges. */
  labelKey: string
  /** Short badge text shown on cards, e.g. 'FBX'. */
  badge: string
  match(entry: TreeEntry): boolean
  /** Defaults to the generic GUID resolver once it exists (Phase 3). */
  resolveDependencies?(asset: Asset, ctx: ResolveContext): Promise<DepNode[]>
  getStats?(asset: Asset): Promise<AssetStats>
  checks?: AssetCheck[]
  preview: PreviewProvider
}

export interface RepoRef {
  /** "owner/name" */
  fullName: string
  defaultBranch: string
}
