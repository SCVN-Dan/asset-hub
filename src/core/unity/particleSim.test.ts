import { describe, expect, it } from 'vitest'
import { evalGradient, evalMinMax, evalMinMaxColor, parseParticleSim, readMinMax, readMinMaxColor } from './particleSim'

const curveYaml = `    startSize:
      serializedVersion: 2
      minMaxState: 1
      scalar: 2
      minScalar: 1
      maxCurve:
        serializedVersion: 2
        m_Curve:
        - serializedVersion: 3
          time: 0
          value: 0
          inSlope: 0
          outSlope: 0
          tangentMode: 0
        - serializedVersion: 3
          time: 1
          value: 1
          inSlope: 0
          outSlope: 0
          tangentMode: 0
        m_PreInfinity: 2
`

const gradientYaml = `    startColor:
      serializedVersion: 2
      minMaxState: 1
      minColor: {r: 1, g: 1, b: 1, a: 1}
      maxColor: {r: 1, g: 1, b: 1, a: 1}
      maxGradient:
        serializedVersion: 2
        key0: {r: 1, g: 0, b: 0, a: 1}
        key1: {r: 0, g: 0, b: 1, a: 0}
        key2: {r: 0, g: 0, b: 0, a: 0}
        ctime0: 0
        ctime1: 65535
        atime0: 0
        atime1: 65535
        m_Mode: 0
        m_NumColorKeys: 2
        m_NumAlphaKeys: 2
`

describe('particle values', () => {
  it('evaluates MinMaxCurves like Unity: constant, curve × scalar, random between constants', () => {
    const curve = readMinMax(curveYaml, 4, 'startSize')
    expect(curve.mode).toBe(1)
    expect(evalMinMax(curve, 0, 0)).toBe(0)
    expect(evalMinMax(curve, 0.5, 0)).toBeCloseTo(1)
    expect(evalMinMax(curve, 1, 0)).toBe(2)
    expect(evalMinMax({ mode: 3, scalar: 4, min: 2 }, 0, 0.5)).toBe(3)
    expect(evalMinMax(readMinMax('', 4, 'startSpeed', 5), 0, 0)).toBe(5)
  })

  it('evaluates gradients with colour and alpha keys apart', () => {
    const c = readMinMaxColor(gradientYaml, 4, 'startColor')
    expect(evalMinMaxColor(c, 0, 0)).toEqual([1, 0, 0, 1])
    expect(evalGradient(c.gradient!, 0.5).map((v) => +v.toFixed(2))).toEqual([0.5, 0, 0.5, 0.5])
    expect(evalMinMaxColor({ mode: 2, max: [1, 1, 1, 1], min: [0, 0, 0, 0] }, 0, 0.25)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('reads the modules a preview plays', () => {
    const ps = `ParticleSystem:
  lengthInSec: 2
  looping: 1
  moveWithTransform: 1
  InitialModule:
    enabled: 1
${curveYaml}    maxNumParticles: 50
  ShapeModule:
    enabled: 1
    type: 4
    angle: 30
    m_Position: {x: 0, y: 1, z: 0}
    m_Rotation: {x: -90, y: 0, z: 0}
    m_Scale: {x: 1, y: 1, z: 1}
    radius:
      value: 0.5
      mode: 0
    arc:
      value: 180
  UVModule:
    enabled: 1
    tilesX: 4
    tilesY: 4
    animationType: 0
  ColorModule:
    enabled: 0
`
    const sim = parseParticleSim(ps, '  m_LengthScale: 3\n')
    expect(sim).toMatchObject({ duration: 2, looping: true, worldSpace: true, maxParticles: 50, lengthScale: 3 })
    expect(sim.shape).toMatchObject({ type: 4, angle: 30, radius: 0.5, arc: 180, position: [0, 1, 0], rotation: [-90, 0, 0] })
    expect(sim.sheet).toMatchObject({ tilesX: 4, tilesY: 4, singleRow: false })
    expect(sim.colorOverLifetime).toBeUndefined()
  })

  it('reads sub emitters and trails', () => {
    const ps = `ParticleSystem:
  lengthInSec: 1
  SubModule:
    serializedVersion: 2
    enabled: 1
    subEmitters:
    - serializedVersion: 3
      emitter: {fileID: 0}
      type: 0
      properties: 0
      emitProbability: 1
    - serializedVersion: 3
      emitter: {fileID: 4567}
      type: 2
      properties: 1
      emitProbability: 0.5
  TrailModule:
    enabled: 1
    mode: 0
    ratio: 0.5
    lifetime:
      serializedVersion: 2
      minMaxState: 0
      scalar: 0.3
      minScalar: 0.3
    minVertexDistance: 0.1
    sizeAffectsWidth: 1
    inheritParticleColor: 1
    widthOverTrail:
      serializedVersion: 2
      minMaxState: 0
      scalar: 0.2
      minScalar: 0.2
`
    const sim = parseParticleSim(ps)
    // The empty slot (fileID 0) is left out.
    expect(sim.subEmitters).toEqual([{ id: '4567', type: 'death', inherit: 1, probability: 0.5 }])
    expect(sim.trail).toMatchObject({ ratio: 0.5, minVertexDistance: 0.1, sizeAffectsWidth: true, inheritParticleColor: true })
    expect(evalMinMax(sim.trail!.lifetime, 0, 0)).toBe(0.3)
    expect(evalMinMax(sim.trail!.width, 0, 0)).toBe(0.2)
    expect(parseParticleSim(ps.replace('    mode: 0\n    ratio', '    mode: 1\n    ratio')).trail).toBeUndefined()
  })
})
