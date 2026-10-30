import type { StatsSummary } from '@core/checks/playable'
import type { LiveContext } from '../components/ModelViewer'
import { importedTextureSize, parseTextureMeta } from '@core/index'
import { unwrap } from '../remoteSource'
import { decodeImage } from './textures'

const W = 320
const H = 240

/**
 * Grid thumbnail of a texture: the image itself, fitted on a dark background,
 * plus its measurements (size in pixels and bytes) for ranking.
 */
export async function renderImageThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const [bytes, meta] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path, true).then(unwrap),
    window.api.assets.readFile(live.repo, live.branch, `${path}.meta`, true).then((r) => (r.ok ? new TextDecoder().decode(r.data) : undefined))
  ])
  const imp = meta ? parseTextureMeta(meta) : undefined
  const img = await decodeImage(path, bytes, imp?.alphaSource)
  // Judged at the size it is built at: a 2048 px source capped to 512 on import is fine for playables.
  const built = imp ? importedTextureSize(img.width, img.height, imp) : Math.max(img.width, img.height)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const g = canvas.getContext('2d')!
    g.fillStyle = '#1a1e26'
    g.fillRect(0, 0, W, H)
    const scale = Math.min((W - 16) / img.width, (H - 16) / img.height, 1)
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    g.drawImage(img.bitmap, (W - w) / 2, (H - h) / 2, w, h)
    return {
      url: canvas.toDataURL('image/webp', 0.85),
      stats: {
        triangles: 0,
        vertices: 0,
        bones: 0,
        clips: 0,
        materials: 0,
        fileBytes: 0,
        textureBytes: bytes.byteLength,
        maxTextureSize: built,
        width: img.width,
        height: img.height,
        // A texture is measured in full from the file alone.
        source: 'viewer'
      }
    }
  } finally {
    img.bitmap.close()
  }
}
