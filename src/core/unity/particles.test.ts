import { describe, expect, it } from 'vitest'
import { effectShas, parseParticleSystems, particleTotals, prefabEffectFact } from './particles'
import { parsePrefabScene } from './prefabScene'

const curve = (indent: number, key: string, state: number, scalar: number, min = scalar) => {
  const pad = ' '.repeat(indent)
  return `${pad}${key}:\n${pad}  serializedVersion: 2\n${pad}  minMaxState: ${state}\n${pad}  scalar: ${scalar}\n${pad}  minScalar: ${min}\n${pad}  maxCurve:\n${pad}    serializedVersion: 2\n${pad}    m_Curve: []\n`
}

/** One GameObject with a particle system and its renderer, as Unity writes them (trimmed). */
const emitter = (id: number, name: string, opts: { looping?: number; burst?: string; modules?: string; renderer?: string }) => `--- !u!1 &${id}
GameObject:
  m_Name: ${name}
--- !u!198 &${id + 1}
ParticleSystem:
  m_GameObject: {fileID: ${id}}
  serializedVersion: 8
  lengthInSec: 2
  looping: ${opts.looping ?? 0}
  prewarm: 0
${curve(2, 'startDelay', 0, 0)}  InitialModule:
    serializedVersion: 3
    enabled: 1
${curve(4, 'startLifetime', 3, 0.5, 0.8)}${curve(4, 'startSpeed', 0, 4)}${curve(4, 'startSize', 1, 0.3)}    maxNumParticles: 200
  ShapeModule:
    serializedVersion: 6
    enabled: 1
    type: 4
  EmissionModule:
    enabled: 1
    serializedVersion: 4
${curve(4, 'rateOverTime', 0, 20)}${curve(4, 'rateOverDistance', 0, 0)}    m_BurstCount: 1
${opts.burst ?? '    m_Bursts: []\n'}  UVModule:
    serializedVersion: 2
    enabled: ${opts.modules?.includes('uv') ? 1 : 0}
    tilesX: 4
    tilesY: 2
  NoiseModule:
    enabled: ${opts.modules?.includes('noise') ? 1 : 0}
  CollisionModule:
    enabled: 0
    type: 0
  SubModule:
    serializedVersion: 2
    enabled: 0
    subEmitters:
    - serializedVersion: 3
      emitter: {fileID: 0}
  TrailModule:
    enabled: ${opts.modules?.includes('trails') ? 1 : 0}
--- !u!199 &${id + 2}
ParticleSystemRenderer:
  m_GameObject: {fileID: ${id}}
  m_Enabled: 1
  m_Materials:
  - {fileID: 2100000, guid: ${'a'.repeat(32)}, type: 2}
  - {fileID: 2100000, guid: ${'b'.repeat(32)}, type: 2}
${opts.renderer ?? '  m_RenderMode: 0\n  m_Mesh: {fileID: 0}\n'}`

const BURSTS = `    m_Bursts:
    - serializedVersion: 2
      time: 0
${curve(6, 'countCurve', 3, 10, 30)}      cycleCount: 2
      repeatInterval: 0.1
    - serializedVersion: 2
      time: 0.5
${curve(6, 'countCurve', 0, 5)}      cycleCount: 1
`

describe('particle systems', () => {
  const yaml = `%YAML 1.1\n${emitter(100, 'Sparks', { burst: BURSTS, modules: 'uv noise trails' })}${emitter(200, 'Glow', { looping: 1, renderer: `  m_RenderMode: 4\n  m_Mesh: {fileID: 4300000, guid: ${'c'.repeat(32)}, type: 3}\n` })}`

  it('reads each emitter with its upper start values, emission and renderer', () => {
    const [sparks, glow] = parseParticleSystems(yaml)
    expect(sparks).toMatchObject({
      name: 'Sparks',
      duration: 2,
      looping: false,
      lifetime: 0.8,
      speed: 4,
      size: 0.3,
      maxParticles: 200,
      rate: 20,
      // 30 × 2 cycles + 5
      bursts: 65,
      // 20/s × 0.8 s + 65
      peak: 81,
      shape: 'Cone',
      renderMode: 'billboard',
      material: 'a'.repeat(32),
      trailMaterial: 'b'.repeat(32),
      modules: ['noise', 'trails', 'textureSheet'],
      sheet: [4, 2],
      subEmitters: 0
    })
    expect(glow).toMatchObject({ name: 'Glow', looping: true, renderMode: 'mesh', mesh: 'c'.repeat(32), bursts: 0, peak: 16 })
    expect(glow).not.toHaveProperty('trailMaterial')
  })

  it('adds an effect up', () => {
    expect(particleTotals(parseParticleSystems(yaml))).toEqual({ emitters: 2, peak: 97, duration: 2.8, looping: true })
  })

  it('caps the peak at the maximum particle count', () => {
    const big = emitter(100, 'Rain', { burst: BURSTS.replace(/scalar: 30/, 'scalar: 900').replace(/minScalar: 30/, 'minScalar: 900') })
    expect(parseParticleSystems(big)[0].peak).toBe(200)
  })

  it('lists particle materials and meshes on the prefab scene', () => {
    const scene = parsePrefabScene(yaml)
    expect(scene.particleSystems).toBe(2)
    expect(scene.particleMaterials).toEqual(['a'.repeat(32), 'b'.repeat(32)])
    expect(scene.particleMeshes).toEqual(['c'.repeat(32)])
  })
})

describe('effect prefabs', () => {
  const A = 'a'.repeat(32)
  const B = 'b'.repeat(32)
  it('takes a prefab with its own particle system, or a variant of one — not one that only holds an effect', () => {
    const own = '--- !u!1 &1\nGameObject:\n--- !u!198 &198\nParticleSystem:\n'
    const variant = `--- !u!1001 &5\nPrefabInstance:\n  m_Modification:\n    m_TransformParent: {fileID: 0}\n  m_SourcePrefab: {fileID: 100100000, guid: ${A}, type: 3}\n--- !u!198 &77 stripped\nParticleSystem:\n`
    const holder = `--- !u!1 &1\nGameObject:\n  m_Name: Additive GameObjects\n--- !u!4 &4\nTransform:\n  m_GameObject: {fileID: 1}\n--- !u!1001 &5\nPrefabInstance:\n  m_Modification:\n    m_TransformParent: {fileID: 4}\n  m_SourcePrefab: {fileID: 100100000, guid: ${A}, type: 3}\n`
    expect(prefabEffectFact(own)).toBe('1')
    expect(prefabEffectFact(variant)).toBe(A)
    expect(prefabEffectFact(holder)).toBe('')
  })

  it('takes effects by their root particle system, or by being particles only — not models with an effect attached', () => {
    const doc = (cls: number, id: number, body: string) => `--- !u!${cls} &${id}\n${body}\n`
    const go = (id: number, name: string) => doc(1, id, `GameObject:\n  m_Name: ${name}`)
    const tf = (id: number, goId: number, father: number) => doc(4, id, `Transform:\n  m_GameObject: {fileID: ${goId}}\n  m_Father: {fileID: ${father}}`)
    const ps = (id: number, goId: number) => doc(198, id, `ParticleSystem:\n  m_GameObject: {fileID: ${goId}}`)
    const mr = (id: number, goId: number) => doc(23, id, `MeshRenderer:\n  m_GameObject: {fileID: ${goId}}`)
    // Root is a particle system, with a mesh shockwave under it: an effect.
    expect(prefabEffectFact(go(1, 'FX_Hit') + tf(4, 1, 0) + ps(198, 1) + go(2, 'Ring') + tf(5, 2, 4) + mr(23, 2))).toBe('1')
    // Empty root, particle systems under it: an effect.
    expect(prefabEffectFact(go(1, 'FX_Aura') + tf(4, 1, 0) + go(2, 'Glow') + tf(5, 2, 4) + ps(198, 2))).toBe('1')
    // A machine with sparks: a model.
    expect(prefabEffectFact(go(1, 'CuttingMachine') + tf(4, 1, 0) + mr(23, 1) + go(2, 'FX_SawGlint') + tf(5, 2, 4) + ps(198, 2))).toBe('')
  })

  it('follows variants of variants', () => {
    const facts = new Map([
      ['fx', '1'],
      ['variant', A],
      ['variant2', B],
      ['plain', '']
    ])
    const guids = new Map([
      [A, 'fx'],
      [B, 'variant']
    ])
    expect([...effectShas(facts, guids)].sort()).toEqual(['fx', 'variant', 'variant2'])
  })
})
