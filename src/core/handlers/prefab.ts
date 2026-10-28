import { resolvePrefabDependencies } from '../deps/prefab'
import type { AssetTypeHandler } from '../types'

const PREFAB_EXT = /\.prefab$/i

/**
 * Prefabs: put together from their models and materials in a 3D preview; an
 * export carries every model, nested prefab, material, texture and custom
 * script they use. Particle prefabs (Phase 9) will register a handler before this one.
 */
export const prefabHandler: AssetTypeHandler = {
  id: 'prefab',
  labelKey: 'assetTypes.prefab',
  badge: 'PFB',
  match: (entry) => PREFAB_EXT.test(entry.path),
  resolveDependencies: resolvePrefabDependencies,
  preview: {
    kind: 'prefab',
    // Put together in the renderer with three.js; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
