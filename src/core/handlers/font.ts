import { resolveSelf } from '../deps/self'
import type { AssetTypeHandler } from '../types'

/** Font files Unity imports (TextMeshPro font assets are .asset files made from these). */
const FONT_EXT = /\.(ttf|otf|ttc)$/i

/** Fonts: sample text and character coverage in the app; exported with their .meta so TMP font assets keep pointing at them. */
export const fontHandler: AssetTypeHandler = {
  id: 'font',
  labelKey: 'assetTypes.font',
  badge: 'FONT',
  match: (entry) => FONT_EXT.test(entry.path),
  usesGuids: false,
  resolveDependencies: resolveSelf,
  // TextMeshPro font assets are listed here too, once a scan has found which .asset files they are.
  facts: 'tmpFonts',
  alsoShows: (asset, _stats, facts) => asset.type === 'tmpFont' && !!facts?.tmpFonts?.has(asset.sha),
  preview: {
    kind: 'font',
    // Drawn in the renderer with the font itself; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
