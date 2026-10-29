import type { ParticleEmitter } from '../unity/particles'
export type ShaderKind = 'builtin' | 'package' | 'project'

export interface ShaderRef {
  guid: string
  label: string
  kind: ShaderKind
  path?: string
}

export interface TextureRef {
  /** Material slot, e.g. _BaseMap; absent for names found inside the FBX. */
  prop?: string
  guid?: string
  /** Repo path when found. */
  path?: string
  name: string
  /** How it was found: by GUID (exact) or by file name (heuristic, needs confirmation). */
  matchedBy: 'guid' | 'name'
  missing: boolean
  /** Not found yet, but the project was not fully searched: may still turn up. */
  unsure?: boolean
  size?: number
}

export interface MaterialRef {
  name: string
  /** Material name inside the FBX that this .mat replaces (externalObjects), used to place textures in the preview. */
  sourceName?: string
  guid?: string
  path?: string
  missing: boolean
  /** Not found yet, but the project was not fully searched: may still turn up. */
  unsure?: boolean
  shader?: ShaderRef
  textures: TextureRef[]
}

export type DependencyWarning =
  | 'missingMaterial'
  | 'missingTexture'
  | 'textureByName'
  | 'customShader'
  | 'noMeta'
  | 'noMaterials'
  | 'missingModel'
  | 'customScript'
  | 'particles'
  | 'uiPrefab'

/**
 * `known` only names prefabs read before that use the model (nothing loaded);
 * `cached` also loads their materials; `near` reads related folders; `all` reads every prefab.
 */
export type PrefabScope = 'known' | 'cached' | 'near' | 'all'

/** A prefab that uses a model, and the materials its renderers put on that model. */
export interface PrefabUsage {
  path: string
  materials: MaterialRef[]
}

export interface PrefabMaterialsResult {
  scope: PrefabScope
  prefabs: PrefabUsage[]
  /** Prefabs checked for this answer (scanned now or known from earlier scans). */
  scanned: number
  /** Prefabs not checked yet, and their size — what "scan all" would add. */
  remaining: number
  remainingBytes: number
  /** Materials, textures and shaders (with .meta) to add to an export. */
  files: string[]
  warnings: DependencyWarning[]
}

/** A model, nested prefab, script or other asset a prefab uses. */
export interface PartRef {
  kind: 'model' | 'prefab' | 'script' | 'other'
  guid: string
  name: string
  path?: string
  missing: boolean
  unsure?: boolean
  size?: number
  /** How many times the prefab (and the prefabs inside it) uses it. */
  uses: number
}

export interface DependencyReport {
  /** A: materials extracted to .mat; B: embedded in the FBX; none: material import disabled. */
  kind: 'A' | 'B' | 'none'
  materials: MaterialRef[]
  /** Textures referenced by name inside the FBX itself. */
  embeddedTextures: TextureRef[]
  /** Answered from the files nearest the model only; a full answer follows. */
  partial?: boolean
  warnings: DependencyWarning[]
  /**
   * .mat files next to an FBX that has no materials of its own — a guess, since
   * nothing references them. Not part of `files` unless the user picks one.
   */
  suggested: Array<{ material: MaterialRef; files: string[] }>
  /** Every repo path that an import would copy (assets and their .meta files). */
  files: string[]
  /** Prefabs: models, nested prefabs, scripts and other assets, in order of use. */
  parts?: PartRef[]
  /** Animation clips: models that may carry the rig it animates, most likely first. */
  rigs?: string[]
  /** Prefabs: GUID → repo path of everything found, so a preview can put the prefab together. */
  guidPaths?: Record<string, string>
  /** Prefabs: their particle systems, nested prefabs' included (`prefab` names the nested one). */
  particles?: Array<ParticleEmitter & { prefab?: string }>
}
