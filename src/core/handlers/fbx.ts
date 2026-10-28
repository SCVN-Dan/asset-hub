import { resolveFbxDependencies } from '../deps/fbx'
import type { AssetTypeHandler } from '../types'

const FBX_EXT = /\.fbx$/i

/** FBX models: kind A materials via GUID, kind B textures via names inside the FBX. */
export const fbxHandler: AssetTypeHandler = {
  id: 'fbx',
  labelKey: 'assetTypes.fbx',
  badge: 'FBX',
  match: (entry) => FBX_EXT.test(entry.path),
  resolveDependencies: resolveFbxDependencies,
  materialsFromPrefabs: true,
  preview: {
    kind: 'three',
    // Rendered in the renderer with three.js; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
