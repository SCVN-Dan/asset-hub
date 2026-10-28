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
  key: 'triangles' | 'textureSize' | 'textureBytes' | 'fileBytes' | 'bones'
  value: number
  limit: number
}

/** Defaults for mobile playable ads; a project preset can override them later. */
export const PLAYABLE_BUDGET = {
  triangles: 15_000,
  textureSize: 1024,
  textureBytes: 4 * 1024 * 1024,
  fileBytes: 5 * 1024 * 1024,
  bones: 60
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
  /** For a material: how many textures it uses (no triangles). */
  textureCount?: number
  /** `viewer` counts every texture the model uses; `thumb` only the ones named inside the FBX. */
  source: 'thumb' | 'viewer'
}

export function summarizeStats(stats: ModelStats, source: StatsSummary['source']): StatsSummary {
  return {
    triangles: stats.triangles,
    vertices: stats.vertices,
    bones: stats.bones,
    clips: stats.animations.length,
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
  if (s.fileBytes > budget.fileBytes) issues.push({ key: 'fileBytes', value: s.fileBytes, limit: budget.fileBytes })
  if (s.bones > budget.bones) issues.push({ key: 'bones', value: s.bones, limit: budget.bones })
  return issues
}

/** Checks a summary read back from disk or IPC. */
export function isStatsSummary(v: unknown): v is StatsSummary {
  const s = v as Record<string, unknown> | null
  return (
    !!s &&
    ['triangles', 'vertices', 'bones', 'clips', 'materials', 'fileBytes', 'textureBytes', 'maxTextureSize'].every((k) => typeof s[k] === 'number' && Number.isFinite(s[k] as number) && (s[k] as number) >= 0) &&
    (s.source === 'thumb' || s.source === 'viewer')
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
  matchOf: (item: T) => number = () => 0
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
            ? [summaryIssues(s).length, size, -usedOf(item)]
            : mode === 'smallest'
              ? [size, s.triangles]
              : [s.width || s.textureCount !== undefined ? 1 : 0, s.triangles, size] // textures and materials (no triangles) after models
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
