import type { AssetTypeHandler } from '../types'

const FBX_EXT = /\.fbx$/i

/**
 * Phase 1: recognises FBX files only. Dependency resolution (kind A via GUID,
 * kind B via texture names), stats and the three.js preview arrive in Phase 3.
 */
export const fbxHandler: AssetTypeHandler = {
  id: 'fbx',
  labelKey: 'assetTypes.fbx',
  badge: 'FBX',
  match: (entry) => FBX_EXT.test(entry.path),
  preview: {
    kind: 'three',
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.notYet' })
  }
}
