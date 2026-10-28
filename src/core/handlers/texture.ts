import type { AssetTypeHandler } from '../types'

/** Image files Unity imports as textures. EXR / HDR / TIFF are listed, though the preview cannot draw them. */
const TEXTURE_EXT = /\.(png|jpe?g|tga|psd|gif|bmp|tiff?|exr|hdr)$/i

/** Textures: previewed as images; an export carries the file and its .meta (import settings, GUID). */
export const textureHandler: AssetTypeHandler = {
  id: 'texture',
  labelKey: 'assetTypes.texture',
  badge: 'TEX',
  match: (entry) => TEXTURE_EXT.test(entry.path),
  usesGuids: false,
  // Artists just want the image: saved as a plain file, no package.
  delivery: 'file',
  resolveDependencies: async (path, ctx) => {
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
  },
  preview: {
    kind: 'image',
    // Drawn in the renderer; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
