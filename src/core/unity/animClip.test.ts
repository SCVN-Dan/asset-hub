import { describe, expect, it } from 'vitest'
import { parseAnimClip, sampleCurve } from './animClip'
import { rigCandidates } from '../deps/anim'
import { animationHandler } from '../handlers/animation'
import type { TreeEntry } from '../types'

const key = (t: number, v: string, slope = '{x: 0, y: 0, z: 0, w: 0}') => `      - serializedVersion: 3
        time: ${t}
        value: ${v}
        inSlope: ${slope}
        outSlope: ${slope}
        tangentMode: 0`

const clip = `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: Run
  m_Legacy: 0
  m_Compressed: 0
  m_RotationCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
${key(0, '{x: 0, y: 0, z: 0, w: 1}')}
${key(1, '{x: 0, y: 0.7071068, z: 0, w: 0.7071068}')}
      m_PreInfinity: 2
    path: Armature/Hips
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
${key(0, '{x: 0, y: 0, z: 0}', '{x: 0, y: 0, z: 0}')}
${key(0.5, '{x: 0, y: 1, z: 0}', '{x: 0, y: Infinity, z: 0}')}
    path: 
  m_ScaleCurves: []
  m_FloatCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
${key(0, '0', '0')}
    attribute: m_IsActive
    path: Armature/Hips/Sword
    classID: 1
  m_PPtrCurves: []
  m_SampleRate: 30
  m_AnimationClipSettings:
    serializedVersion: 2
    m_StartTime: 0
    m_StopTime: 1
    m_LoopTime: 1
  m_Events:
  - time: 0.5
    functionName: Step
`

describe('parseAnimClip', () => {
  it('reads transform and float curves, settings and events', () => {
    const c = parseAnimClip(clip)
    expect(c).toMatchObject({ name: 'Run', length: 1, sampleRate: 30, loop: true, kind: 'generic', spriteCurves: 0, events: 1, keyframes: 5 })
    expect(c.transformCurves.map((x) => [x.kind, x.path, x.keys.length])).toEqual([
      ['position', '', 2],
      ['rotation', 'Armature/Hips', 2]
    ])
    expect(c.floatCurves[0]).toMatchObject({ attribute: 'm_IsActive', path: 'Armature/Hips/Sword', classID: 1 })
    expect(c.paths).toEqual(['', 'Armature/Hips', 'Armature/Hips/Sword'])
  })

  it('samples with Hermite easing, holds outside the keys, and steps on infinite tangents', () => {
    const rot = parseAnimClip(clip).transformCurves.find((x) => x.kind === 'rotation')!.keys
    expect(sampleCurve(rot, -1)).toEqual([0, 0, 0, 1])
    // Flat tangents: halfway in time is halfway in value.
    expect(sampleCurve(rot, 0.5)[1]).toBeCloseTo(0.3535534)
    expect(sampleCurve(rot, 0.25)[1]).toBeCloseTo(0.7071068 * 0.15625)
    const pos = parseAnimClip(clip).transformCurves.find((x) => x.kind === 'position')!.keys
    expect(sampleCurve(pos, 0.25)[1]).toBe(0)
  })

  it('tells humanoid, UI and sprite clips apart', () => {
    const float = (attribute: string, classID: number) => `  m_FloatCurves:\n  - curve:\n      m_Curve:\n${key(0, '0', '0')}\n    attribute: ${attribute}\n    path: \n    classID: ${classID}\n  m_PPtrCurves: []\n`
    expect(parseAnimClip(`AnimationClip:\n${float('RootT.x', 95)}`).kind).toBe('humanoid')
    expect(parseAnimClip(`AnimationClip:\n${float('m_SizeDelta.x', 224)}`).kind).toBe('ui')
    const sprite = `AnimationClip:\n  m_PPtrCurves:\n  - curve:\n    - time: 0\n      value: {fileID: 21300000, guid: 0123456789abcdef0123456789abcdef, type: 3}\n    attribute: m_Sprite\n    path: \n  m_SampleRate: 12\n`
    expect(parseAnimClip(sprite)).toMatchObject({ kind: 'sprite', spriteCurves: 1, spriteGuids: ['0123456789abcdef0123456789abcdef'] })
  })
})

describe('rigCandidates', () => {
  it('prefers models named like the clip and its folder over animation files nearby (real project layout)', () => {
    const paths = [
      'p/Assets/Game/FBXs/Enemy/Enemy_Goblin.fbx',
      'p/Assets/Game/FBXs/Enemy/Enemy_Goblin@Run.fbx',
      'p/Assets/Game/FBXs/Prop/Tree.fbx',
      'p/Assets/Game/Animation/Enemy/BigFoot/Standing Melee Attack.fbx',
      'p/Other/Goblin.fbx'
    ]
    const byPath = new Map<string, TreeEntry>(paths.map((p) => [p, { path: p, type: 'blob', sha: p }]))
    const rigs = rigCandidates('p/Assets/Game/Animation/Enemy/Goblin_Melee/Skill1.anim', { root: 'p/', byPath })
    expect(rigs[0]).toBe('p/Assets/Game/FBXs/Enemy/Enemy_Goblin.fbx')
    expect(rigs.indexOf('p/Assets/Game/FBXs/Enemy/Enemy_Goblin@Run.fbx')).toBeGreaterThan(0)
    expect(rigs.indexOf('p/Assets/Game/Animation/Enemy/BigFoot/Standing Melee Attack.fbx')).toBeGreaterThan(0)
    expect(rigs).not.toContain('p/Other/Goblin.fbx')
    expect(animationHandler.match({ path: 'a/Run.ANIM', type: 'blob', sha: 'x' })).toBe(true)
  })
})
