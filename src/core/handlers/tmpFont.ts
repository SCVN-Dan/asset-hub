import { resolveTmpFontDependencies } from '../deps/tmpFont'
import type { AssetTypeHandler } from '../types'

/**
 * TextMeshPro font assets. Any .asset file could be one, so this type has no
 * tab of its own: the Font tab lists the ones a scan found to be fonts.
 */
/**
 * .asset files that may be TextMeshPro fonts: TextMeshPro names them "<Font> SDF" and keeps them under
 * Fonts folders. Other .asset files (settings, terrain data, ScriptableObjects) cannot be previewed:
 * they are not listed at all.
 */
export const TMP_CANDIDATE = /(sdf|font)[^/]*\.asset$|\/fonts?[^/]*\/[^/]*\.asset$/i

export const tmpFontHandler: AssetTypeHandler = {
  id: 'tmpFont',
  labelKey: 'assetTypes.tmpFont',
  badge: 'TMP',
  match: (entry) => TMP_CANDIDATE.test(entry.path),
  hidden: true,
  usesGuids: true,
  resolveDependencies: resolveTmpFontDependencies,
  preview: {
    kind: 'tmpfont',
    // Drawn in the renderer from the atlas inside the asset.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
