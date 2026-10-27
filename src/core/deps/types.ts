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
  size?: number
}

export interface MaterialRef {
  name: string
  guid?: string
  path?: string
  missing: boolean
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

export interface DependencyReport {
  /** A: materials extracted to .mat; B: embedded in the FBX; none: material import disabled. */
  kind: 'A' | 'B' | 'none'
  materials: MaterialRef[]
  /** Textures referenced by name inside the FBX itself. */
  embeddedTextures: TextureRef[]
  warnings: DependencyWarning[]
  /** Every repo path that an import would copy (assets and their .meta files). */
  files: string[]
}
