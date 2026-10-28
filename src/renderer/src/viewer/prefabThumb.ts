import { summarizeStats, type StatsSummary } from '@core/checks/playable'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import { offscreenHost } from './backgroundThumb'
import { FbxViewer } from './FbxViewer'
import { buildPrefab, dressPrefab } from './prefabBuild'

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
 * using GUIDs known nearby (`quick`). Measured like a model.
 */
export async function renderPrefabThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats?: StatsSummary }> {
  const report = unwrap(await window.api.assets.resolve(live.repo, live.branch, path, live.root, 'quick'))
  const build = await buildPrefab(live, path, report, true)
  try {
    if (!build.meshes) return { url: labelCard(report.warnings.includes('uiPrefab') ? 'UI' : report.warnings.includes('particles') ? 'FX' : '—') }
    const viewer = new FbxViewer(offscreenHost())
    try {
      viewer.showGroup(build.group)
      await dressPrefab(viewer, build)
      return { url: viewer.snapshot(), stats: summarizeStats(viewer.stats(build.modelBytes, build.textures), report.partial ? 'thumb' : 'viewer') }
    } finally {
      viewer.dispose()
    }
  } finally {
    build.dispose()
  }
}
