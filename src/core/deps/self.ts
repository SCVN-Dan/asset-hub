import type { DepContext } from './fbx'
import type { DependencyReport } from './types'

/** A file that needs nothing else (a texture, an audio clip): itself and its .meta. */
export async function resolveSelf(path: string, ctx: DepContext): Promise<DependencyReport> {
  const meta = `${path}.meta`
  const hasMeta = ctx.byPath.has(meta)
  return {
    kind: 'none',
    materials: [],
    embeddedTextures: [],
    suggested: [],
    warnings: hasMeta ? [] : ['noMeta'],
    files: hasMeta ? [path, meta] : [path]
  }
}
