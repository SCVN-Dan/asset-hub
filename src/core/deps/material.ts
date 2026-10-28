import { metaGuid } from '../unity/yaml'
import { describeMaterials, type DepContext } from './fbx'
import type { DependencyReport } from './types'

/**
 * A .mat on its own: its shader, textures (and a variant's parent), the same
 * way an FBX's materials are described. Its GUID comes from its .meta, so the
 * material resolves even before the branch's GUID index has it.
 */
export async function resolveMaterialDependencies(matPath: string, ctx: DepContext): Promise<DependencyReport> {
  const metaPath = `${matPath}.meta`
  const guid = metaGuid((await ctx.readTexts([metaPath])).get(metaPath) ?? '')
  // Without a .meta there is no GUID: any placeholder resolves to the file itself.
  const own = guid ?? 'self'
  const sub: DepContext = { ...ctx, pathForGuid: (g) => (g === own ? matPath : ctx.pathForGuid(g)) }
  const described = await describeMaterials([{ guid: own }], sub)
  const files = new Set([matPath, ...described.files])
  const material = described.materials[0]
  const partial = material.unsure || material.textures.some((t) => t.unsure)
  return {
    kind: 'A',
    materials: guid ? described.materials : [{ ...material, guid: undefined }],
    embeddedTextures: [],
    suggested: [],
    partial: partial || undefined,
    warnings: guid ? described.warnings : ['noMeta', ...described.warnings],
    files: [...files]
  }
}
