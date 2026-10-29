import type { AssetTypeHandler } from '../types'

/**
 * Sprites tab: textures Unity imports as sprites (texture type Sprite in
 * their .meta). They stay textures — previewed with their sprite frames and
 * 9-slice borders, taken as files — this tab only lists them apart.
 */
export const spriteHandler: AssetTypeHandler = {
  id: 'sprite',
  labelKey: 'assetTypes.sprite',
  badge: 'SPR',
  match: () => false,
  facts: 'sprites',
  alsoShows: (asset, _stats, facts) => asset.type === 'texture' && !!facts?.sprites?.has(asset.sha),
  preview: {
    kind: 'image',
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
