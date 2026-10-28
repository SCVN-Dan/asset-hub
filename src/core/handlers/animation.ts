import { resolveAnimationDependencies } from '../deps/anim'
import type { AssetTypeHandler } from '../types'

const ANIM_EXT = /\.anim$/i

/** Animation clips: played on a model with a matching rig; an export carries the clip and what it references. */
export const animationHandler: AssetTypeHandler = {
  id: 'animation',
  labelKey: 'assetTypes.animation',
  badge: 'ANIM',
  match: (entry) => ANIM_EXT.test(entry.path),
  resolveDependencies: resolveAnimationDependencies,
  // Models holding clips (measured), or named like animation files (Model@Run.fbx), are animations too.
  alsoShows: (asset, stats) => asset.type === 'fbx' && ((stats?.clips ?? 0) > 0 || asset.name.includes('@')),
  preview: {
    kind: 'animation',
    // Played in the renderer with three.js; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
