import { summarizeStats, type StatsSummary } from '@core/checks/playable'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import { offscreenHost } from './backgroundThumb'
import { FbxViewer } from './FbxViewer'
import { buildPrefab, dressPrefab } from './prefabBuild'
import { FX_THUMB_VERSION, filmEffect, particleStats } from './particleThumb'
import { buildEffect } from './effectBuild'
import { MODEL_THUMB_VERSION } from './thumbVersions'

/** A card for prefabs with nothing 3D to draw (UI, effects, scripts only): their kind, written large. */
function labelCard(label: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const g = canvas.getContext('2d')!
  g.fillStyle = '#1a1e26'
  g.fillRect(0, 0, 320, 240)
  g.fillStyle = '#5b6474'
  g.font = '600 44px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, 160, 120)
  return canvas.toDataURL('image/webp', 0.85)
}

/**
 * Grid thumbnail of a prefab: its models put together with their materials,
 * using GUIDs known nearby (`quick`). Measured like a model; effects are
 * filmed through their run (`motion`, played on hover) with the busiest
 * frame as the card, and measured by particles.
 */
export async function renderPrefabThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats?: StatsSummary; motion?: string }> {
  const report = unwrap(await window.api.assets.resolve(live.repo, live.branch, path, live.root, 'quick'))
  const build = await buildPrefab(live, path, report, true)
  try {
    const fx = report.particles?.length ? report : undefined
    if (!build.meshes && !build.anchors.length) return { url: labelCard(report.warnings.includes('uiPrefab') ? 'UI' : '—') }
    const viewer = new FbxViewer(offscreenHost())
    const effect = build.anchors.length ? await buildEffect(live, report, build.anchors, true).catch(() => undefined) : undefined
    try {
      viewer.showGroup(build.group, effect?.measuredExtent())
      await dressPrefab(viewer, build)
      const film = effect && filmEffect(viewer, effect)
      const url = film?.still ?? viewer.snapshot()
      if (!fx) return { url, stats: { ...summarizeStats(viewer.stats(build.modelBytes, build.textures), report.partial ? 'thumb' : 'viewer'), modelThumb: MODEL_THUMB_VERSION } }
      const stats = build.meshes ? particleStats(fx, summarizeStats(viewer.stats(build.modelBytes, build.textures), report.partial ? 'thumb' : 'viewer')) : particleStats(fx)
      return { url, motion: film?.motion, stats: { ...stats, maxTextureSize: Math.max(stats.maxTextureSize, effect?.maxTextureSize ?? 0), modelThumb: MODEL_THUMB_VERSION, ...(film ? { fxThumb: FX_THUMB_VERSION } : {}) } }
    } finally {
      effect?.dispose()
      viewer.dispose()
    }
  } finally {
    build.dispose()
  }
}
