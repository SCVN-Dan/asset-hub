/** Model numbers measured in the viewer. */
export interface ModelStats {
  triangles: number
  vertices: number
  meshes: number
  materials: number
  bones: number
  animations: string[]
  textures: Array<{ name: string; width?: number; height?: number; bytes: number }>
  fileBytes: number
}

export interface BudgetIssue {
  key: 'triangles' | 'textureSize' | 'textureBytes' | 'fileBytes' | 'bones' | 'audioBytes' | 'audioLength' | 'fontBytes' | 'particles'
  value: number
  limit: number
}

/** Limits one asset is judged against for playable ads. */
export interface PlayableBudget {
  triangles: number
  /** Largest texture side, in pixels (as built). */
  textureSize: number
  textureBytes: number
  /** One model file. */
  fileBytes: number
  bones: number
  /** One audio clip as built: playables carry a few short sounds and one music loop. */
  audioBytes: number
  audioSeconds: number
  /** One font file: a whole font (Korean, CJK) easily outweighs the rest of a playable. */
  fontBytes: number
  /** Particles alive at once in one effect (all its emitters): each is drawn and simulated every frame. */
  particles: number
}

export const BUDGET_KEYS = ['triangles', 'textureSize', 'textureBytes', 'fileBytes', 'bones', 'audioBytes', 'audioSeconds', 'fontBytes', 'particles'] as const satisfies ReadonlyArray<keyof PlayableBudget>

const MB = 1024 * 1024

/** For networks taking a 5 MB playable (Google, AppLovin, ironSource, Unity…): the default. */
export const PLAYABLE_BUDGET: PlayableBudget = {
  triangles: 15_000,
  textureSize: 1024,
  textureBytes: 4 * MB,
  fileBytes: 5 * MB,
  bones: 60,
  audioBytes: MB,
  audioSeconds: 60,
  fontBytes: MB,
  particles: 1000
}

/** For networks capping the whole playable at 2 MB (Meta): every asset has to be lighter. */
export const TIGHT_BUDGET: PlayableBudget = {
  triangles: 8_000,
  textureSize: 512,
  textureBytes: MB,
  fileBytes: 1.5 * MB,
  bones: 40,
  audioBytes: 256 * 1024,
  audioSeconds: 30,
  fontBytes: 300 * 1024,
  particles: 400
}

/** `off`: assets are not judged for playables at all (not everything is made for one). */
export const BUDGET_PRESETS = ['off', 'standard', 'tight', 'custom'] as const
export type BudgetPreset = (typeof BUDGET_PRESETS)[number]
/** Until someone picks a preset, nothing is judged against a playable budget. */
export const DEFAULT_BUDGET_PRESET: BudgetPreset = 'off'

/** The budget a preset stands for; `custom` fills what it does not set from the default. */
export function budgetFor(preset: BudgetPreset | undefined, custom?: Partial<PlayableBudget>): PlayableBudget {
  if (preset === 'tight') return TIGHT_BUDGET
  if (preset === 'custom') return { ...PLAYABLE_BUDGET, ...custom }
  return PLAYABLE_BUDGET
}

export function checkPlayableBudget(stats: ModelStats, budget = PLAYABLE_BUDGET): BudgetIssue[] {
  return summaryIssues(summarizeStats(stats, 'viewer'), budget)
}

/**
 * What is kept per model (by content SHA) so search results can be ranked
 * without opening them. Measured when a thumbnail renders or the model opens.
 */
export interface StatsSummary {
  triangles: number
  vertices: number
  bones: number
  clips: number
  materials: number
  fileBytes: number
  textureBytes: number
  /** Largest texture side in pixels (for a texture asset: as built, after the import max size). */
  maxTextureSize: number
  /** For a texture asset: its size in pixels (no triangles). */
  width?: number
  height?: number
  /** For an audio clip: its length in seconds (no triangles); `fileBytes` is then its estimated size in a build. */
  duration?: number
  /** Names of the animation clips inside a model (FBX), so they can be searched. */
  clipNames?: string[]
  /** For an animation clip: its length in seconds (no triangles). */
  clipLength?: number
  /** For a material: how many textures it uses (no triangles). */
  textureCount?: number
  /** For a font: how many glyphs it has; `fileBytes` is then the font file. */
  glyphs?: number
  /** For an effect (a prefab with particle systems): most particles alive at once, and how many emitters. */
  particles?: number
  emitters?: number
  /** Version of the effect card drawn for it (a still plus frames played on hover); older ones are drawn again. */
  fxThumb?: number
  /** `viewer` counts every texture the model uses; `thumb` the ones named inside the FBX, plus those of its .mat files when `matTextures`. */
  source: 'thumb' | 'viewer'
  /** A model thumbnail that also counted the textures of its .mat files (older ones did not, and are measured again once). */
  matTextures?: true
}

const MAX_CLIP_NAMES = 30

export function summarizeStats(stats: ModelStats, source: StatsSummary['source']): StatsSummary {
  return {
    triangles: stats.triangles,
    vertices: stats.vertices,
    bones: stats.bones,
    clips: stats.animations.length,
    ...(stats.animations.length ? { clipNames: stats.animations.slice(0, MAX_CLIP_NAMES) } : {}),
    materials: stats.materials,
    fileBytes: stats.fileBytes,
    textureBytes: stats.textures.reduce((s, t) => s + t.bytes, 0),
    maxTextureSize: Math.max(0, ...stats.textures.map((t) => Math.max(t.width ?? 0, t.height ?? 0))),
    source
  }
}

export function summaryIssues(s: StatsSummary, budget = PLAYABLE_BUDGET): BudgetIssue[] {
  const issues: BudgetIssue[] = []
  if (s.triangles > budget.triangles) issues.push({ key: 'triangles', value: s.triangles, limit: budget.triangles })
  if (s.maxTextureSize > budget.textureSize) issues.push({ key: 'textureSize', value: s.maxTextureSize, limit: budget.textureSize })
  if (s.textureBytes > budget.textureBytes) issues.push({ key: 'textureBytes', value: s.textureBytes, limit: budget.textureBytes })
  // Audio clips and fonts are judged by their own budgets below.
  if (s.glyphs !== undefined) {
    if (s.fileBytes > budget.fontBytes) issues.push({ key: 'fontBytes', value: s.fileBytes, limit: budget.fontBytes })
  } else if (s.duration === undefined && s.fileBytes > budget.fileBytes) issues.push({ key: 'fileBytes', value: s.fileBytes, limit: budget.fileBytes })
  if (s.particles !== undefined && s.particles > budget.particles) issues.push({ key: 'particles', value: s.particles, limit: budget.particles })
  if (s.bones > budget.bones) issues.push({ key: 'bones', value: s.bones, limit: budget.bones })
  if (s.duration !== undefined) {
    if (s.fileBytes > budget.audioBytes) issues.push({ key: 'audioBytes', value: s.fileBytes, limit: budget.audioBytes })
    if (s.duration > budget.audioSeconds) issues.push({ key: 'audioLength', value: Math.round(s.duration), limit: budget.audioSeconds })
  }
  return issues
}

/** Checks a summary read back from disk or IPC. */
/**
 * What to keep when a new measurement comes in: a thumbnail only sees part of
 * the textures, so it never replaces a full (viewer) measurement — clip names
 * and the effect card version it brings are added to it instead.
 */
export function mergeStats(kept: StatsSummary | undefined, summary: StatsSummary): StatsSummary {
  // A remeasured effect keeps the card already drawn for it.
  if (summary.source !== 'thumb' || kept?.source !== 'viewer') return kept?.fxThumb && !summary.fxThumb ? { ...summary, fxThumb: kept.fxThumb } : summary
  const merged = { ...kept }
  if (summary.clipNames && !kept.clipNames) merged.clipNames = summary.clipNames
  if (summary.fxThumb) merged.fxThumb = summary.fxThumb
  return merged
}

export function isStatsSummary(v: unknown): v is StatsSummary {
  const s = v as Record<string, unknown> | null
  return (
    !!s &&
    ['triangles', 'vertices', 'bones', 'clips', 'materials', 'fileBytes', 'textureBytes', 'maxTextureSize'].every((k) => typeof s[k] === 'number' && Number.isFinite(s[k] as number) && (s[k] as number) >= 0) &&
    (s.source === 'thumb' || s.source === 'viewer') &&
    (s.clipNames === undefined || (Array.isArray(s.clipNames) && s.clipNames.every((n) => typeof n === 'string')))
  )
}

/** How a result list is ordered. `relevance` keeps the search order. */
export type SortMode = 'relevance' | 'playable' | 'smallest' | 'triangles' | 'used'

/**
 * Orders results for reuse in playables. Models not measured yet keep their
 * relative order after the measured ones (`used` needs no measurements).
 */
export function rankForPlayable<T>(
  items: readonly T[],
  mode: SortMode,
  statsOf: (item: T) => StatsSummary | undefined,
  usedOf: (item: T) => number = () => 0,
  /** Search match strength: a closer match always ranks above a lighter but looser one. */
  matchOf: (item: T) => number = () => 0,
  budget: PlayableBudget = PLAYABLE_BUDGET
): T[] {
  if (mode === 'relevance') return [...items]
  const keyed = items.map((item, index) => {
    const s = statsOf(item)
    const size = s ? s.fileBytes + s.textureBytes : Infinity
    const keys: number[] =
      mode === 'used'
        ? [-usedOf(item)]
        : !s
          ? [Infinity]
          : mode === 'playable'
            ? [summaryIssues(s, budget).length, size, -usedOf(item)]
            : mode === 'smallest'
              ? [size, s.triangles]
              : [s.width || s.textureCount !== undefined || s.duration !== undefined || s.clipLength !== undefined ? 1 : 0, s.triangles, size] // textures, materials, audio and clips (no triangles) after models
    return { item, index, keys: [-matchOf(item), ...keys] }
  })
  keyed.sort((a, b) => {
    for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
      const d = (a.keys[i] ?? 0) - (b.keys[i] ?? 0)
      if (d && !Number.isNaN(d)) return d
      if (a.keys[i] === Infinity && b.keys[i] !== Infinity) return 1
      if (b.keys[i] === Infinity && a.keys[i] !== Infinity) return -1
    }
    return a.index - b.index
  })
  return keyed.map((k) => k.item)
}

/** Width/height from an image file header (PNG, JPEG, TGA) without decoding it. */
export function imageSize(name: string, bytes: Uint8Array): { width: number; height: number } | undefined {
  const lower = name.toLowerCase()
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }
  if (bytes.length > 26 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) return { width: dv.getUint32(18), height: dv.getUint32(14) } // PSD, whatever its name
  if (lower.endsWith('.tga') && bytes.length > 18) return { width: dv.getUint16(12, true), height: dv.getUint16(14, true) }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) return undefined
      const marker = bytes[i + 1]
      const len = dv.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) }
      i += 2 + len
    }
  }
  return undefined
}
