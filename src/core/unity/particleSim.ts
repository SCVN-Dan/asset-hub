// What it takes to play a particle system: Unity's MinMaxCurve / MinMaxGradient
// values and the modules a preview simulates, read from a ParticleSystem's
// YAML, and evaluated the way Unity does (curves sampled as Hermite splines).

import { sampleCurve, type CurveKey } from './animClip'

/** Unity's MinMaxCurve: a constant, a curve (× scalar), random between two curves, or between two constants. */
export interface MinMax {
  mode: 0 | 1 | 2 | 3
  scalar: number
  min: number
  curve?: CurveKey[]
  minCurve?: CurveKey[]
}

export interface ColorKey {
  t: number
  /** r, g, b, a in 0–1. */
  c: [number, number, number, number]
}

export interface Gradient {
  colors: Array<{ t: number; r: number; g: number; b: number }>
  alphas: Array<{ t: number; a: number }>
}

/** Unity's MinMaxGradient: a colour, a gradient, random between two colours or two gradients, or a random colour of a gradient. */
export interface MinMaxColor {
  mode: 0 | 1 | 2 | 3 | 4
  max: [number, number, number, number]
  min: [number, number, number, number]
  gradient?: Gradient
  minGradient?: Gradient
}

export interface ParticleShape {
  /** Unity's ParticleSystemShapeType. */
  type: number
  radius: number
  /** 0 emits from the edge only, 1 from the whole volume. */
  radiusThickness: number
  /** Cone half angle, in degrees. */
  angle: number
  /** Degrees of the circle used (360 = all). */
  arc: number
  /** Cone volume length. */
  length: number
  position: [number, number, number]
  /** Euler degrees. */
  rotation: [number, number, number]
  scale: [number, number, number]
  randomDirection: number
}

export interface ParticleSim {
  duration: number
  looping: boolean
  prewarm: boolean
  /** Particles keep moving in the world (1) or with the emitter (0). */
  worldSpace: boolean
  simulationSpeed: number
  startDelay: MinMax
  startLifetime: MinMax
  startSpeed: MinMax
  startSize: MinMax
  /** Radians. */
  startRotation: MinMax
  startColor: MinMaxColor
  gravity: MinMax
  maxParticles: number
  rate: MinMax
  bursts: Array<{ time: number; count: MinMax; cycles: number; interval: number; probability: number }>
  shape?: ParticleShape
  /** Added to each particle's velocity (local axes unless `velocityWorld`). */
  velocity?: [MinMax, MinMax, MinMax]
  velocityWorld?: boolean
  force?: [MinMax, MinMax, MinMax]
  /** Limit velocity: speed above `limit` is reduced by `dampen` each frame. */
  limit?: { limit: MinMax; dampen: number }
  colorOverLifetime?: MinMaxColor
  sizeOverLifetime?: MinMax
  /** Radians per second. */
  rotationOverLifetime?: MinMax
  sheet?: { tilesX: number; tilesY: number; singleRow: boolean; row: number; frame: MinMax; startFrame: MinMax; cycles: number }
  noise?: { strength: MinMax; frequency: number; scrollSpeed: number }
  /** Systems this one starts at its particles (ParticleSystem fileIDs); they emit only then. */
  subEmitters?: Array<{ id: string; type: SubEmitterType; /** Unity's inherit flags: 1 colour, 2 size, 4 rotation, 8 lifetime. */ inherit: number; probability: number }>
  trail?: ParticleTrail
  /** Renderer settings for stretched billboards. */
  lengthScale: number
  velocityScale: number
  /** Largest size on screen, as a fraction of the view height. */
  maxScreenSize: number
}

export type SubEmitterType = 'birth' | 'collision' | 'death' | 'trigger' | 'manual'
const SUB_TYPES: SubEmitterType[] = ['birth', 'collision', 'death', 'trigger', 'manual']

/** Trails behind particles (Trail module, Particles mode). */
export interface ParticleTrail {
  /** Share of particles that get a trail. */
  ratio: number
  /** How long a trail point lasts, as a share of the particle's lifetime. */
  lifetime: MinMax
  minVertexDistance: number
  sizeAffectsWidth: boolean
  inheritParticleColor: boolean
  width: MinMax
  colorOverLifetime: MinMaxColor
  colorOverTrail: MinMaxColor
}

/** The lines nested under `key:` at this indent (list items at the same indent included). */
export function yamlBlock(text: string, indent: number, key: string): string {
  const head = new RegExp(`^ {${indent}}${key}:[^\\n]*\\n`, 'm').exec(text)
  if (!head) return ''
  const rest = text.slice(head.index + head[0].length)
  const end = new RegExp(`^(?! {${indent}}- ) {0,${indent}}\\S`, 'm').exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

const NUM = '(-?(?:[\\d.]+(?:[eE][-+]?\\d+)?|Infinity))'

export function yamlNum(text: string, indent: number, key: string): number | undefined {
  const v = Number(new RegExp(`^ {${indent}}${key}: ${NUM}`, 'm').exec(text)?.[1])
  return Number.isNaN(v) ? undefined : v
}

const vec3 = (text: string, indent: number, key: string): [number, number, number] | undefined => {
  const m = new RegExp(`^ {${indent}}${key}: \\{x: ${NUM}, y: ${NUM}, z: ${NUM}\\}`, 'm').exec(text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

const rgba = (text: string, indent: number, key: string): [number, number, number, number] | undefined => {
  const m = new RegExp(`^ {${indent}}${key}: \\{r: ${NUM}, g: ${NUM}, b: ${NUM}, a: ${NUM}\\}`, 'm').exec(text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : undefined
}

/** Keys of an AnimationCurve block (`m_Curve:` list). */
function curveKeys(block: string): CurveKey[] {
  const keys: CurveKey[] = []
  for (const m of block.matchAll(new RegExp(`time: ${NUM}\\s+value: ${NUM}\\s+inSlope: ${NUM}\\s+outSlope: ${NUM}`, 'g')))
    keys.push({ t: Number(m[1]), v: [Number(m[2])], inS: [Number(m[3])], outS: [Number(m[4])] })
  return keys
}

/** A MinMaxCurve under `key` at `indent`; `fallback` when absent. */
export function readMinMax(text: string, indent: number, key: string, fallback = 0): MinMax {
  const b = yamlBlock(text, indent, key)
  if (!b) return { mode: 0, scalar: fallback, min: fallback }
  const mode = (yamlNum(b, indent + 2, 'minMaxState') ?? 0) as MinMax['mode']
  const out: MinMax = { mode, scalar: yamlNum(b, indent + 2, 'scalar') ?? fallback, min: yamlNum(b, indent + 2, 'minScalar') ?? 0 }
  if (mode === 1 || mode === 2) {
    out.curve = curveKeys(yamlBlock(b, indent + 2, 'maxCurve'))
    if (mode === 2) out.minCurve = curveKeys(yamlBlock(b, indent + 2, 'minCurve'))
  }
  return out
}

function readGradient(text: string, indent: number, key: string): Gradient | undefined {
  const b = yamlBlock(text, indent, key)
  if (!b) return undefined
  const nColors = yamlNum(b, indent + 2, 'm_NumColorKeys') ?? 2
  const nAlphas = yamlNum(b, indent + 2, 'm_NumAlphaKeys') ?? 2
  const colors: Gradient['colors'] = []
  const alphas: Gradient['alphas'] = []
  for (let i = 0; i < 8; i++) {
    const k = rgba(b, indent + 2, `key${i}`) ?? [1, 1, 1, 1]
    // Times are stored as 0–65535.
    if (i < nColors) colors.push({ t: (yamlNum(b, indent + 2, `ctime${i}`) ?? 0) / 65535, r: k[0], g: k[1], b: k[2] })
    if (i < nAlphas) alphas.push({ t: (yamlNum(b, indent + 2, `atime${i}`) ?? 0) / 65535, a: k[3] })
  }
  return { colors, alphas }
}

export function readMinMaxColor(text: string, indent: number, key: string): MinMaxColor {
  const b = yamlBlock(text, indent, key)
  const white: [number, number, number, number] = [1, 1, 1, 1]
  if (!b) return { mode: 0, max: white, min: white }
  return {
    mode: (yamlNum(b, indent + 2, 'minMaxState') ?? 0) as MinMaxColor['mode'],
    max: rgba(b, indent + 2, 'maxColor') ?? white,
    min: rgba(b, indent + 2, 'minColor') ?? white,
    gradient: readGradient(b, indent + 2, 'maxGradient'),
    minGradient: readGradient(b, indent + 2, 'minGradient')
  }
}

const on = (module: string) => /^ {4}enabled: 1/m.test(module)

/** Everything a preview needs to play one ParticleSystem document. */
export function parseParticleSim(ps: string, renderer?: string): ParticleSim {
  const initial = yamlBlock(ps, 2, 'InitialModule')
  const emission = yamlBlock(ps, 2, 'EmissionModule')
  const shape = yamlBlock(ps, 2, 'ShapeModule')
  const velocity = yamlBlock(ps, 2, 'VelocityModule')
  const force = yamlBlock(ps, 2, 'ForceModule')
  const limit = yamlBlock(ps, 2, 'ClampVelocityModule')
  const color = yamlBlock(ps, 2, 'ColorModule')
  const size = yamlBlock(ps, 2, 'SizeModule')
  const rotation = yamlBlock(ps, 2, 'RotationModule')
  const uv = yamlBlock(ps, 2, 'UVModule')
  const noise = yamlBlock(ps, 2, 'NoiseModule')
  const emits = on(emission)

  const sim: ParticleSim = {
    duration: yamlNum(ps, 2, 'lengthInSec') ?? 5,
    looping: yamlNum(ps, 2, 'looping') === 1,
    prewarm: yamlNum(ps, 2, 'prewarm') === 1,
    worldSpace: yamlNum(initial, 4, 'simulationSpace') === 1 || yamlNum(ps, 2, 'moveWithTransform') === 1,
    simulationSpeed: yamlNum(ps, 2, 'simulationSpeed') ?? 1,
    startDelay: readMinMax(ps, 2, 'startDelay'),
    startLifetime: readMinMax(initial, 4, 'startLifetime', 5),
    startSpeed: readMinMax(initial, 4, 'startSpeed', 5),
    startSize: readMinMax(initial, 4, 'startSize', 1),
    startRotation: readMinMax(initial, 4, 'startRotation'),
    startColor: readMinMaxColor(initial, 4, 'startColor'),
    gravity: readMinMax(initial, 4, 'gravityModifier'),
    maxParticles: yamlNum(initial, 4, 'maxNumParticles') ?? 1000,
    rate: emits ? readMinMax(emission, 4, 'rateOverTime', 10) : { mode: 0, scalar: 0, min: 0 },
    bursts: emits
      ? yamlBlock(emission, 4, 'm_Bursts')
          .split(/^ {4}- /m)
          .slice(1)
          .map((item) => {
            const b = `      ${item}`
            return {
              time: yamlNum(b, 6, 'time') ?? 0,
              count: readMinMax(b, 6, 'countCurve', 30),
              cycles: yamlNum(b, 6, 'cycleCount') ?? 1,
              interval: Math.max(0.01, yamlNum(b, 6, 'repeatInterval') ?? 0.01),
              probability: yamlNum(b, 6, 'probability') ?? 1
            }
          })
      : [],
    lengthScale: (renderer ? yamlNum(renderer, 2, 'm_LengthScale') : undefined) ?? 2,
    velocityScale: (renderer ? yamlNum(renderer, 2, 'm_VelocityScale') : undefined) ?? 0,
    maxScreenSize: (renderer ? yamlNum(renderer, 2, 'm_MaxParticleSize') : undefined) ?? 0.5
  }
  if (on(shape))
    sim.shape = {
      type: yamlNum(shape, 4, 'type') ?? 4,
      // radius and arc are MultiModeParameters: their `value` sits one level down.
      radius: yamlNum(yamlBlock(shape, 4, 'radius'), 6, 'value') ?? yamlNum(shape, 4, 'radius') ?? 1,
      radiusThickness: yamlNum(shape, 4, 'radiusThickness') ?? 1,
      angle: yamlNum(shape, 4, 'angle') ?? 25,
      arc: yamlNum(yamlBlock(shape, 4, 'arc'), 6, 'value') ?? 360,
      length: yamlNum(shape, 4, 'length') ?? 5,
      position: vec3(shape, 4, 'm_Position') ?? [0, 0, 0],
      rotation: vec3(shape, 4, 'm_Rotation') ?? [0, 0, 0],
      scale: vec3(shape, 4, 'm_Scale') ?? [1, 1, 1],
      randomDirection: yamlNum(shape, 4, 'randomDirectionAmount') ?? 0
    }
  if (on(velocity)) {
    sim.velocity = [readMinMax(velocity, 4, 'x'), readMinMax(velocity, 4, 'y'), readMinMax(velocity, 4, 'z')]
    sim.velocityWorld = yamlNum(velocity, 4, 'inWorldSpace') === 1
  }
  if (on(force)) sim.force = [readMinMax(force, 4, 'x'), readMinMax(force, 4, 'y'), readMinMax(force, 4, 'z')]
  if (on(limit)) sim.limit = { limit: readMinMax(limit, 4, 'magnitude', 1), dampen: yamlNum(limit, 4, 'dampen') ?? 0 }
  if (on(color)) sim.colorOverLifetime = readMinMaxColor(color, 4, 'gradient')
  if (on(size)) sim.sizeOverLifetime = readMinMax(size, 4, 'curve', 1)
  if (on(rotation)) sim.rotationOverLifetime = readMinMax(rotation, 4, 'curve', Math.PI / 4)
  if (on(uv))
    sim.sheet = {
      tilesX: Math.max(1, yamlNum(uv, 4, 'tilesX') ?? 1),
      tilesY: Math.max(1, yamlNum(uv, 4, 'tilesY') ?? 1),
      singleRow: yamlNum(uv, 4, 'animationType') === 1,
      row: yamlNum(uv, 4, 'rowIndex') ?? 0,
      frame: readMinMax(uv, 4, 'frameOverTime', 1),
      startFrame: readMinMax(uv, 4, 'startFrame'),
      cycles: yamlNum(uv, 4, 'cycles') ?? 1
    }
  const sub = yamlBlock(ps, 2, 'SubModule')
  if (on(sub)) {
    const list = yamlBlock(sub, 4, 'subEmitters')
      .split(/^ {4}- /m)
      .slice(1)
      .flatMap((item) => {
        const b = `      ${item}`
        const id = /emitter: \{fileID: (-?\d+)/.exec(b)?.[1]
        if (!id || id === '0') return []
        return [{ id, type: SUB_TYPES[yamlNum(b, 6, 'type') ?? 0] ?? 'birth', inherit: yamlNum(b, 6, 'properties') ?? 0, probability: yamlNum(b, 6, 'emitProbability') ?? 1 }]
      })
    if (list.length) sim.subEmitters = list
  }
  const trail = yamlBlock(ps, 2, 'TrailModule')
  // Ribbon mode (1) joins particles together: not drawn.
  if (on(trail) && (yamlNum(trail, 4, 'mode') ?? 0) === 0)
    sim.trail = {
      ratio: yamlNum(trail, 4, 'ratio') ?? 1,
      lifetime: readMinMax(trail, 4, 'lifetime', 1),
      minVertexDistance: yamlNum(trail, 4, 'minVertexDistance') ?? 0.2,
      sizeAffectsWidth: yamlNum(trail, 4, 'sizeAffectsWidth') === 1,
      inheritParticleColor: yamlNum(trail, 4, 'inheritParticleColor') === 1,
      width: readMinMax(trail, 4, 'widthOverTrail', 1),
      colorOverLifetime: readMinMaxColor(trail, 4, 'colorOverLifetime'),
      colorOverTrail: readMinMaxColor(trail, 4, 'colorOverTrail')
    }
  if (on(noise))
    sim.noise = { strength: readMinMax(noise, 4, 'strength', 1), frequency: yamlNum(noise, 4, 'frequency') ?? 0.5, scrollSpeed: yamlNum(noise, 4, 'scrollSpeed') ?? 0 }
  return sim
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** A MinMaxCurve at normalised time `t` (0–1), for a particle's own random `r` (0–1). */
export function evalMinMax(c: MinMax, t: number, r: number): number {
  switch (c.mode) {
    case 1:
      return c.scalar * (c.curve?.length ? sampleCurve(c.curve, t)[0] : 1)
    case 2:
      return c.scalar * lerp(c.minCurve?.length ? sampleCurve(c.minCurve, t)[0] : 0, c.curve?.length ? sampleCurve(c.curve, t)[0] : 1, r)
    case 3:
      return lerp(c.min, c.scalar, r)
    default:
      return c.scalar
  }
}

/** Colour of a gradient at `t`: colour and alpha keys interpolated separately, as Unity does. */
export function evalGradient(g: Gradient, t: number): [number, number, number, number] {
  const pick = <K extends { t: number }>(keys: readonly K[], f: (k: K) => number[]): number[] => {
    if (!keys.length) return [1, 1, 1, 1]
    if (t <= keys[0].t) return f(keys[0])
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1]
        const b = keys[i]
        const s = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
        return f(a).map((v, j) => lerp(v, f(b)[j], s))
      }
    }
    return f(keys[keys.length - 1])
  }
  const [r, gr, b] = pick(g.colors, (k) => [k.r, k.g, k.b])
  const [a] = pick(g.alphas, (k) => [k.a])
  return [r, gr, b, a]
}

/** A MinMaxGradient at `t` for a particle's random `r`. */
export function evalMinMaxColor(c: MinMaxColor, t: number, r: number): [number, number, number, number] {
  switch (c.mode) {
    case 1:
      return c.gradient ? evalGradient(c.gradient, t) : c.max
    case 2:
      return c.min.map((v, i) => lerp(v, c.max[i], r)) as [number, number, number, number]
    case 3: {
      const a = c.minGradient ? evalGradient(c.minGradient, t) : c.min
      const b = c.gradient ? evalGradient(c.gradient, t) : c.max
      return a.map((v, i) => lerp(v, b[i], r)) as [number, number, number, number]
    }
    case 4:
      return c.gradient ? evalGradient(c.gradient, r) : c.max
    default:
      return c.max
  }
}
