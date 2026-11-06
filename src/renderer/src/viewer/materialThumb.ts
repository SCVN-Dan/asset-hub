import type { StatsSummary } from '@core/checks/playable'
import { parseMaterialLook } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import { offscreenHost } from './backgroundThumb'
import { FbxViewer } from './FbxViewer'
import { fetchMaterialTextures, materialSlots, materialStats } from './materialPreview'

/**
 * Grid thumbnail of a material: a sphere with its textures and colour, plus
 * what its textures weigh. Uses what the branch already knows about GUIDs
 * nearby (`quick`), so a texture still unknown is left off until it is opened.
 */
export async function renderMaterialThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const [bytes, report] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path, true).then(unwrap),
    window.api.assets.resolve(live.repo, live.branch, path, live.root, 'full', true).then(unwrap)
  ])
  const material = report.materials[0]
  const textures = await fetchMaterialTextures(live, material, true)
  const viewer = new FbxViewer(offscreenHost())
  try {
    const look = parseMaterialLook(new TextDecoder().decode(bytes))
    // Effects (transparent) on a flat card, like the viewer.
    viewer.showShape(look.surface === 'transparent' ? 'plane' : 'sphere')
    await viewer.applyMaterialSlots(materialSlots(material, textures))
    viewer.setLook(look)
    return { url: viewer.snapshot(), stats: materialStats(material, textures, bytes.byteLength, !report.partial) }
  } finally {
    viewer.dispose()
    textures.forEach((x) => URL.revokeObjectURL(x.file.url))
  }
}
