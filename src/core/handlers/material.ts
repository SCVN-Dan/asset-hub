import { resolveMaterialDependencies } from '../deps/material'
import type { AssetTypeHandler } from '../types'

const MAT_EXT = /\.mat$/i

/** Materials: previewed on a sphere; an export carries the .mat with its shader and textures. */
export const materialHandler: AssetTypeHandler = {
  id: 'material',
  labelKey: 'assetTypes.material',
  badge: 'MAT',
  match: (entry) => MAT_EXT.test(entry.path),
  resolveDependencies: resolveMaterialDependencies,
  preview: {
    kind: 'material',
    // Drawn in the renderer with three.js; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
