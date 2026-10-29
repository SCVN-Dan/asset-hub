import type { AssetTypeHandler } from '../types'

/**
 * Effects tab: prefabs with particle systems. It owns no files of its own
 * (they stay prefabs, previewed and exported as such); it lists prefabs found
 * to have particle systems of their own (or variants of one) when the
 * branch's prefabs were scanned.
 */
export const vfxHandler: AssetTypeHandler = {
  id: 'vfx',
  labelKey: 'assetTypes.vfx',
  badge: 'VFX',
  match: () => false,
  facts: 'effects',
  // Only the scan decides: measured particles include effects merely placed inside a prefab.
  alsoShows: (asset, _stats, facts) => asset.type === 'prefab' && !!facts?.effects?.has(asset.sha),
  preview: {
    kind: 'prefab',
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
