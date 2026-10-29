import type { StatsSummary } from '@core/checks/playable'
import { particleTotals, type DependencyReport, type MaterialRef } from '@core/index'
import type { FbxViewer } from './FbxViewer'
import type { EffectPlayer } from './particlePlayer'

/** Main colour map of a particle material, by the slot names Unity's particle shaders use. */
const MAIN_PROPS = ['_MainTex', '_BaseMap', '_BaseColorMap', '_Texture', '_TintTex']

/** The texture that gives a particle material its look. */
export function mainTexture(m: MaterialRef | undefined): string | undefined {
  const withPath = (m?.textures ?? []).filter((t) => t.path)
  return (withPath.find((t) => MAIN_PROPS.includes(t.prop ?? '')) ?? withPath[0])?.path
}

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

/** Frames of a moving effect card, laid out as a square sheet. */
export const MOTION_FRAMES = 16
const MOTION_COLS = 4
/** Bumped when effect cards are drawn differently: older ones are drawn again once. */
export const FX_THUMB_VERSION = 2

/** Cache key of an effect's moving card, next to its still one. */
export const motionKey = (key: string) => `${key}.fx`

/**
 * Plays an effect through and films it: a sheet of frames covering its whole
 * run (one cycle for loops), for the card to play on hover, and the busiest
 * frame as the still card.
 */
export function filmEffect(viewer: FbxViewer, effect: EffectPlayer, width = 320, height = 240): { still: string; motion: string } {
  const rows = Math.ceil(MOTION_FRAMES / MOTION_COLS)
  const sheet = document.createElement('canvas')
  sheet.width = width * MOTION_COLS
  sheet.height = height * rows
  const g = sheet.getContext('2d')!
  const { warm, length } = effect.span()
  effect.advance(warm)
  let busiest = 0
  let most = -1
  for (let i = 0; i < MOTION_FRAMES; i++) {
    effect.advance(length / MOTION_FRAMES)
    viewer.drawFrame(g, (i % MOTION_COLS) * width, Math.floor(i / MOTION_COLS) * height, width, height)
    if (effect.alive > most) [busiest, most] = [i, effect.alive]
  }
  const still = document.createElement('canvas')
  still.width = width
  still.height = height
  still.getContext('2d')!.drawImage(sheet, (busiest % MOTION_COLS) * width, Math.floor(busiest / MOTION_COLS) * height, width, height, 0, 0, width, height)
  return { still: still.toDataURL('image/webp', 0.85), motion: sheet.toDataURL('image/webp', 0.8) }
}
