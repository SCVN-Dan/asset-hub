// Particle systems of a prefab, read from its YAML: what each emitter does
// and what it costs, for a playable. Values that Unity drives by curves are
// taken at their maximum (the curve multiplier), which is what a budget needs.

import { materialList, ref, refGuid, splitDocs } from './prefabScene'
import { parseParticleSim, type ParticleSim } from './particleSim'

/** Unity's built-in meshes, by file ID in its default resources. */
export const BUILTIN_MESHES = { '10202': 'cube', '10206': 'cylinder', '10207': 'sphere', '10208': 'capsule', '10209': 'plane', '10210': 'quad' } as const
export type BuiltinMesh = (typeof BUILTIN_MESHES)[keyof typeof BUILTIN_MESHES]
const DEFAULT_RESOURCES = '0000000000000000e000000000000000'

export type ParticleRenderMode = 'billboard' | 'stretched' | 'horizontal' | 'vertical' | 'mesh' | 'none'

/** Optional modules worth knowing about (others, like colour over lifetime, cost little). */
export type ParticleModule = 'noise' | 'collision' | 'trails' | 'lights' | 'subEmitters' | 'textureSheet' | 'velocity' | 'force' | 'externalForces'

export interface ParticleEmitter {
  /** fileID of the ParticleSystem. */
  id: string
  name: string
  /** Seconds one cycle lasts. */
  duration: number
  looping: boolean
  prewarm: boolean
  /** Upper ends of the start values. */
  lifetime: number
  speed: number
  size: number
  maxParticles: number
  /** Particles per second. */
  rate: number
  /** Particles from bursts in one cycle. */
  bursts: number
  /** Most particles alive at once, as far as the settings tell: rate × lifetime + bursts, capped at the maximum. */
  peak: number
  shape?: string
  renderMode: ParticleRenderMode
  /** Material GUIDs: the particles', and the trails' when trails are on. */
  material?: string
  trailMaterial?: string
  /** Mesh GUID when particles are meshes. */
  mesh?: string
  /** Which mesh of that model (its fileID: models often hold many). */
  meshFileID?: string
  /** One of Unity's own meshes (Quad, Cube…), which no repo holds. */
  builtinMesh?: BuiltinMesh
  modules: ParticleModule[]
  /** Texture sheet animation grid (columns × rows). */
  sheet?: [number, number]
  subEmitters: number
  /** Transform (fileID) of its GameObject, to place it in the prefab. */
  node?: string
  /** What a preview needs to play it. */
  sim: ParticleSim
}

const RENDER_MODES: ParticleRenderMode[] = ['billboard', 'stretched', 'horizontal', 'vertical', 'mesh', 'none']
const SHAPES = [
  'Sphere',
  'Sphere',
  'Hemisphere',
  'Hemisphere',
  'Cone',
  'Box',
  'Mesh',
  'Cone',
  'Cone',
  'Cone',
  'Circle',
  'Circle',
  'Edge',
  'Mesh renderer',
  'Skinned mesh',
  'Box',
  'Box',
  'Donut',
  'Rectangle',
  'Sprite',
  'Sprite renderer'
]
const MODULES: Array<[string, ParticleModule]> = [
  ['NoiseModule', 'noise'],
  ['CollisionModule', 'collision'],
  ['TrailModule', 'trails'],
  ['LightsModule', 'lights'],
  ['SubModule', 'subEmitters'],
  ['UVModule', 'textureSheet'],
  ['VelocityModule', 'velocity'],
  ['ForceModule', 'force'],
  ['ExternalForcesModule', 'externalForces']
]

/**
 * The lines nested under `key:` at this indent (its value block), or '' when
 * absent. Unity writes list items at the key's own indent (`- …`), so those
 * belong to the block too.
 */
function block(text: string, indent: number, key: string): string {
  const head = new RegExp(`^ {${indent}}${key}:[^\\n]*\\n`, 'm').exec(text)
  if (!head) return ''
  const rest = text.slice(head.index + head[0].length)
  const end = new RegExp(`^(?! {${indent}}- ) {0,${indent}}\\S`, 'm').exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

const num = (text: string, indent: number, key: string) => {
  const v = Number(new RegExp(`^ {${indent}}${key}: (-?[\\d.eE+-]+)`, 'm').exec(text)?.[1])
  return Number.isFinite(v) ? v : undefined
}

/** Upper end of a MinMaxCurve: the constant, the larger of two constants, or the curve multiplier. */
function curveMax(text: string, indent: number, key: string): number {
  const b = block(text, indent, key)
  const state = num(b, indent + 2, 'minMaxState') ?? 0
  const scalar = num(b, indent + 2, 'scalar') ?? 0
  return state === 3 ? Math.max(scalar, num(b, indent + 2, 'minScalar') ?? 0) : scalar
}

const enabled = (module: string) => /^ {4}enabled: 1/m.test(module)

/** Every particle system in a prefab's YAML, with its renderer's material. */
export function parseParticleSystems(yaml: string): ParticleEmitter[] {
  const docs = splitDocs(yaml.replace(/\r\n/g, '\n'))
  const names = new Map<string, string>()
  for (const d of docs) if (d.cls === '1') names.set(d.id, /^\s*m_Name: (.*)$/m.exec(d.body)?.[1]?.trim() ?? '')
  const transforms = new Map<string, string>()
  for (const d of docs) if ((d.cls === '4' || d.cls === '224') && !d.stripped) transforms.set(ref(d.body, 'm_GameObject') ?? '', d.id)
  const renderers = new Map<string, string>()
  for (const d of docs) if (d.cls === '199' && !d.stripped) renderers.set(ref(d.body, 'm_GameObject') ?? '', d.body)

  return docs
    .filter((d) => d.cls === '198' && !d.stripped)
    .map((d) => {
      const go = ref(d.body, 'm_GameObject') ?? ''
      const initial = block(d.body, 2, 'InitialModule')
      const emission = block(d.body, 2, 'EmissionModule')
      const shape = block(d.body, 2, 'ShapeModule')
      const uv = block(d.body, 2, 'UVModule')
      const sub = block(d.body, 2, 'SubModule')
      const modules = MODULES.filter(([key]) => enabled(block(d.body, 2, key))).map(([, m]) => m)

      const lifetime = curveMax(initial, 4, 'startLifetime')
      const maxParticles = num(initial, 4, 'maxNumParticles') ?? 1000
      const emits = enabled(emission)
      const rate = emits ? curveMax(emission, 4, 'rateOverTime') : 0
      let bursts = 0
      if (emits)
        for (const item of block(emission, 4, 'm_Bursts').split(/^ {4}- /m).slice(1)) {
          const cycles = num(`      ${item}`, 6, 'cycleCount') ?? 1
          // 0 cycles repeats for ever: one cycle's worth is alive at a time, roughly.
          bursts += curveMax(`      ${item}`, 6, 'countCurve') * Math.max(1, cycles)
        }
      const subEmitters = enabled(sub) ? [...sub.matchAll(/emitter: \{fileID: (-?\d+)/g)].filter((m) => m[1] !== '0').length : 0

      const renderer = renderers.get(go)
      const rendererOn = renderer !== undefined && !/^\s*m_Enabled: 0/m.test(renderer)
      const materials = renderer ? materialList(renderer) : []
      const renderMode = rendererOn ? (RENDER_MODES[num(renderer!, 2, 'm_RenderMode') ?? 0] ?? 'billboard') : 'none'
      const shapeType = num(shape, 4, 'type')
      return {
        id: d.id,
        name: names.get(go) ?? '',
        duration: num(d.body, 2, 'lengthInSec') ?? 5,
        looping: num(d.body, 2, 'looping') === 1,
        prewarm: num(d.body, 2, 'prewarm') === 1,
        lifetime,
        speed: curveMax(initial, 4, 'startSpeed'),
        size: curveMax(initial, 4, 'startSize'),
        maxParticles,
        rate,
        bursts: Math.round(bursts),
        peak: Math.min(maxParticles, Math.ceil(rate * lifetime + bursts)),
        ...(enabled(shape) && shapeType !== undefined ? { shape: SHAPES[shapeType] ?? `#${shapeType}` } : {}),
        renderMode,
        ...(materials[0] ? { material: materials[0] } : {}),
        ...(modules.includes('trails') && materials[1] ? { trailMaterial: materials[1] } : {}),
        ...(renderMode === 'mesh' && renderer ? meshOf(refGuid(renderer, 'm_Mesh')) : {}),
        modules: modules.filter((m) => m !== 'subEmitters' || subEmitters > 0),
        ...(modules.includes('textureSheet') ? { sheet: [num(uv, 4, 'tilesX') ?? 1, num(uv, 4, 'tilesY') ?? 1] as [number, number] } : {}),
        subEmitters,
        ...(transforms.has(go) ? { node: transforms.get(go) } : {}),
        sim: parseParticleSim(d.body, renderer)
      }
    })
}

/**
 * What a prefab file says about particles, kept per blob SHA: '1' when it is
 * an effect — its root object is a particle system, or it is made of particle
 * systems only (no mesh renderers, no models or prefabs placed in it); for a
 * variant (its root is another prefab), the GUID of that prefab, since a
 * variant of an effect is that effect; else ''. Models with an effect
 * attached (a machine with sparks) are not effects.
 */
export function prefabEffectFact(yaml: string): string {
  const docs = splitDocs(yaml.replace(/\r\n/g, '\n'))
  const systems = docs.filter((d) => d.cls === '198' && !d.stripped)
  if (systems.length) {
    const root = docs.find((d) => (d.cls === '4' || d.cls === '224') && !d.stripped && /m_Father: \{fileID: 0\}/.test(d.body))
    const rootObject = root ? ref(root.body, 'm_GameObject') : undefined
    if (rootObject && systems.some((d) => ref(d.body, 'm_GameObject') === rootObject)) return '1'
    const meshes = docs.some((d) => (d.cls === '23' || d.cls === '137') && !d.stripped)
    if (!meshes && !docs.some((d) => d.cls === '1001')) return '1'
    return ''
  }
  for (const d of docs) {
    if (d.cls !== '1001' || !/m_TransformParent: \{fileID: 0\}/.test(d.body)) continue
    const source = refGuid(d.body, 'm_SourcePrefab')?.guid
    if (source) return source
  }
  return ''
}

/**
 * Prefabs (by blob SHA) that are effects: their own particle systems, or
 * variants of an effect (a few levels of variants). `guidToSha` maps a prefab
 * GUID to the SHA of its file on the branch.
 */
export function effectShas(facts: ReadonlyMap<string, string>, guidToSha: ReadonlyMap<string, string>): Set<string> {
  const effects = new Set([...facts].filter(([, f]) => f === '1').map(([sha]) => sha))
  for (let depth = 0, grew = true; grew && depth < 6; depth++) {
    grew = false
    for (const [sha, f] of facts) {
      if (effects.has(sha) || !f || f === '1') continue
      if (f.split(',').some((g) => effects.has(guidToSha.get(g) ?? ''))) {
        effects.add(sha)
        grew = true
      }
    }
  }
  return effects
}

/** What a whole effect adds up to. */
export interface ParticleTotals {
  emitters: number
  peak: number
  /** Longest one-shot cycle, in seconds (0 when every emitter loops). */
  duration: number
  looping: boolean
}

export function particleTotals(emitters: readonly ParticleEmitter[]): ParticleTotals {
  return {
    emitters: emitters.length,
    peak: emitters.reduce((s, e) => s + e.peak, 0),
    duration: Math.max(0, ...emitters.filter((e) => !e.looping).map((e) => e.duration + e.lifetime)),
    looping: emitters.some((e) => e.looping)
  }
}

function meshOf(ref: { fileID: string; guid: string } | undefined): Pick<ParticleEmitter, 'mesh' | 'meshFileID' | 'builtinMesh'> {
  if (!ref) return {}
  if (ref.guid !== DEFAULT_RESOURCES) return { mesh: ref.guid, meshFileID: ref.fileID }
  const builtin = BUILTIN_MESHES[ref.fileID as keyof typeof BUILTIN_MESHES]
  return builtin ? { builtinMesh: builtin } : {}
}
