import { resolveTmpFontDependencies } from '../deps/tmpFont'
import type { AssetTypeHandler } from '../types'

/**
 * TextMeshPro font assets. Any .asset file could be one, so this type has no
 * tab of its own: the Font tab lists the ones a scan found to be fonts.
 */
export const tmpFontHandler: AssetTypeHandler = {
  id: 'tmpFont',
  labelKey: 'assetTypes.tmpFont',
  badge: 'TMP',
  match: (entry) => /\.asset$/i.test(entry.path),
  hidden: true,
  usesGuids: true,
  resolveDependencies: resolveTmpFontDependencies,
  preview: {
    kind: 'tmpfont',
    // Drawn in the renderer from the atlas inside the asset.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
