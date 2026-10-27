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
  const issues: BudgetIssue[] = []
  if (stats.triangles > budget.triangles) issues.push({ key: 'triangles', value: stats.triangles, limit: budget.triangles })
  const largest = Math.max(0, ...stats.textures.map((t) => Math.max(t.width ?? 0, t.height ?? 0)))
  if (largest > budget.textureSize) issues.push({ key: 'textureSize', value: largest, limit: budget.textureSize })
  const texBytes = stats.textures.reduce((s, t) => s + t.bytes, 0)
  if (texBytes > budget.textureBytes) issues.push({ key: 'textureBytes', value: texBytes, limit: budget.textureBytes })
  if (stats.fileBytes > budget.fileBytes) issues.push({ key: 'fileBytes', value: stats.fileBytes, limit: budget.fileBytes })
  if (stats.bones > budget.bones) issues.push({ key: 'bones', value: stats.bones, limit: budget.bones })
  return issues
}

/** Width/height from an image file header (PNG, JPEG, TGA) without decoding it. */
export function imageSize(name: string, bytes: Uint8Array): { width: number; height: number } | undefined {
  const lower = name.toLowerCase()
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }
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
