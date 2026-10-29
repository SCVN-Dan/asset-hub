import type { StatsSummary } from '@core/checks/playable'
import { particleTotals, type DependencyReport, type MaterialRef, type ParticleEmitter } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import type { TextureFile } from './FbxViewer'
import { fetchTextureFile } from './textures'

/** Emitters drawn on a card: the busiest few are enough to tell the effect apart. */
const MAX_LAYERS = 4
/** Main colour map of a particle material, by the slot names Unity's particle shaders use. */
const MAIN_PROPS = ['_MainTex', '_BaseMap', '_BaseColorMap', '_Texture', '_TintTex']

/** The texture that gives a particle material its look. */
export function mainTexture(m: MaterialRef | undefined): string | undefined {
  const withPath = (m?.textures ?? []).filter((t) => t.path)
  return (withPath.find((t) => MAIN_PROPS.includes(t.prop ?? '')) ?? withPath[0])?.path
}

/** Visible emitters, busiest first, one per material. */
function layers(report: DependencyReport): Array<{ emitter: ParticleEmitter; texture: string }> {
  const byGuid = new Map(report.materials.map((m) => [m.guid, m]))
  const seen = new Set<string>()
  const out: Array<{ emitter: ParticleEmitter; texture: string }> = []
  for (const e of [...(report.particles ?? [])].filter((e) => e.renderMode !== 'none').sort((a, b) => b.peak - a.peak || b.lifetime - a.lifetime)) {
    const texture = mainTexture(byGuid.get(e.material))
    if (!texture || seen.has(texture)) continue
    seen.add(texture)
    out.push({ emitter: e, texture })
    if (out.length === MAX_LAYERS) break
  }
  return out
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })

/** Particle numbers of an effect, merged into what was measured of its models (if any). */
export function particleStats(report: DependencyReport, base?: StatsSummary): StatsSummary {
  const totals = particleTotals(report.particles ?? [])
  const guids = new Set((report.particles ?? []).flatMap((e) => [e.material, e.trailMaterial].filter((g): g is string => !!g)))
  const textures = new Map<string, number>()
  for (const m of report.materials) if (m.guid && guids.has(m.guid)) for (const t of m.textures) if (t.path) textures.set(t.path, t.size ?? 0)
  const textureBytes = [...textures.values()].reduce((a, b) => a + b, 0)
  return {
    ...(base ?? { triangles: 0, vertices: 0, bones: 0, clips: 0, materials: guids.size, fileBytes: 0, textureBytes: 0, maxTextureSize: 0, source: report.partial ? 'thumb' : 'viewer' }),
    ...(base ? {} : { textureBytes }),
    particles: totals.peak,
    emitters: totals.emitters
  }
}

/**
 * Grid card of an effect: the textures of its busiest emitters, added up like
 * glowing particles (the first frame only, for texture sheets). Returns
 * undefined when no emitter has a texture to show.
 */
export async function renderEffectCard(live: LiveContext, report: DependencyReport): Promise<{ url: string; maxTextureSize: number } | undefined> {
  const picked = layers(report)
  if (!picked.length) return undefined
  const files = (await Promise.all(picked.map((l) => fetchTextureFile(live, l.texture, true)))).map((f, i) => (f ? { ...picked[i], file: f } : undefined)).filter((l): l is (typeof picked)[number] & { file: TextureFile } => !!l)
  try {
    if (!files.length) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const g = canvas.getContext('2d')!
    g.fillStyle = '#12151b'
    g.fillRect(0, 0, 320, 240)
    g.globalCompositeOperation = 'lighter'
    let maxTextureSize = 0
    for (const [i, layer] of files.entries()) {
      const img = await loadImage(layer.file.url)
      maxTextureSize = Math.max(maxTextureSize, img.naturalWidth, img.naturalHeight)
      const [cols, rows] = layer.emitter.sheet ?? [1, 1]
      const sw = img.naturalWidth / cols
      const sh = img.naturalHeight / rows
      // Larger layers first, each a little smaller and turned, so overlapping sprites still read.
      const side = 200 - i * 34
      const w = sw >= sh ? side : (side * sw) / sh
      const h = sw >= sh ? (side * sh) / sw : side
      g.save()
      g.translate(160, 120)
      g.rotate((i * Math.PI) / 7)
      g.globalAlpha = i === 0 ? 1 : 0.85
      g.drawImage(img, 0, 0, sw, sh, -w / 2, -h / 2, w, h)
      g.restore()
    }
    return { url: canvas.toDataURL('image/webp', 0.85), maxTextureSize }
  } finally {
    files.forEach((l) => URL.revokeObjectURL(l.file.url))
  }
}
