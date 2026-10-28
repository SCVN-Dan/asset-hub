import type { DepContext } from './deps/fbx'
import type { DependencyReport } from './deps/types'

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

/** Per-type statistics, stored as JSON in the index (`stats_json`). */
export type AssetStats = Record<string, number | string | boolean>

/** `three`: a model; `material`: a material drawn on a shape; `image`: the file as it is. */
export type PreviewKind = 'three' | 'material' | 'audio' | 'image' | 'unity-render'

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
  /** Files this asset needs (materials, textures, shaders), by repo path. */
  resolveDependencies?(repoPath: string, ctx: DepContext): Promise<DependencyReport>
  getStats?(asset: Asset): Promise<AssetStats>
  checks?: AssetCheck[]
  preview: PreviewProvider
  /** Models whose materials may be set on prefabs (FBX): offers the prefab material search. */
  materialsFromPrefabs?: boolean
  /** False when `resolveDependencies` never looks a GUID up (a texture is just itself + .meta). */
  usesGuids?: boolean
  /** How a user takes it: a `.unitypackage` with its dependencies (default), or the file itself (a texture). */
  delivery?: 'unitypackage' | 'file'
}

export interface RepoRef {
  /** "owner/name" */
  fullName: string
  defaultBranch: string
}
