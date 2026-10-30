import { describe, expect, it } from 'vitest'
import { parseAnimClip, sampleCurve } from './animClip'
import { controllersPlaying, rigCandidates } from '../deps/anim'
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
    // Unrelated models are not offered at all.
    expect(rigs).not.toContain('p/Assets/Game/FBXs/Prop/Tree.fbx')
    // The clip's name is an action: other characters' "Idle" files do not outrank the character.
    const idle = rigCandidates('p/Assets/Game/Animation/Enemy/Goblin_Melee/Idle.anim', {
      root: 'p/',
      byPath: new Map<string, TreeEntry>([...byPath, ['p/Assets/Game/Animation/Enemy/Orc/Idle.fbx', { path: 'p/Assets/Game/Animation/Enemy/Orc/Idle.fbx', type: 'blob', sha: 'x' }]])
    })
    expect(idle[0]).toBe('p/Assets/Game/FBXs/Enemy/Enemy_Goblin.fbx')
    expect(idle).not.toContain('p/Assets/Game/Animation/Enemy/Orc/Idle.fbx')
    expect(animationHandler.match({ path: 'a/Run.ANIM', type: 'blob', sha: 'x' })).toBe(true)
  })

  it('also tries models named in the clip file name, when its folders only name the game (xp_hero NetCatch layout)', () => {
    const g = 'p/Assets/NetCatch/'
    const paths = [`${g}Models/ASMR-Fish/LP.fbx`, `${g}Models/ASMR-Fish/Belt.fbx`, `${g}Models/ASMR-Fish/Soldier.fbx`, `${g}Models/Customers/Customer_Red.fbx`, `${g}Models/Customers/The_Bowls.fbx`, `${g}Art/CH/Customer.fbx`, `${g}Models/Player/TF_Player.fbx`, `${g}Models/Weapon/CrossBow.fbx`]
    const byPath = new Map<string, TreeEntry>(paths.map((p) => [p, { path: p, type: 'blob', sha: p }]))
    const rigs = rigCandidates(`${g}Animations/ASMR-Fish/Customer_Idle.anim`, { root: 'p/', byPath })
    // The usual best guess stays first; the models whose file name says "Customer" come next (a folder saying it is not enough).
    expect(new Set(rigs.slice(1, 3))).toEqual(new Set([`${g}Models/Customers/Customer_Red.fbx`, `${g}Art/CH/Customer.fbx`]))
    // An action alone ("Idle") names nobody: nothing is slipped in.
    expect(rigCandidates(`${g}Animations/ASMR-Fish/Idle.anim`, { root: 'p/', byPath })).not.toContain(`${g}Models/Customers/Customer_Red.fbx`)
    // A character's folder keeps its model first even when the clip names what it holds.
    expect(rigCandidates(`${g}Animations/Player/Attack_CrossBow.anim`, { root: 'p/', byPath })[0]).toBe(`${g}Models/Player/TF_Player.fbx`)
  })
})

import { isStatsSummary, summarizeStats } from '../checks/playable'

describe('models holding clips', () => {
  const fbx = (name: string) => ({ id: name, type: 'fbx', path: name, name, sha: name, lfs: false })
  it('are listed with animations when measured with clips, or named Model@Clip', () => {
    expect(animationHandler.alsoShows?.(fbx('Goblin.fbx'), undefined)).toBe(false)
    expect(animationHandler.alsoShows?.(fbx('Goblin@Run.fbx'), undefined)).toBe(true)
    const stats = summarizeStats({ triangles: 1, vertices: 3, meshes: 1, materials: 1, bones: 20, animations: ['Run', 'Attack'], textures: [], fileBytes: 10 }, 'thumb')
    expect(stats).toMatchObject({ clips: 2, clipNames: ['Run', 'Attack'] })
    expect(isStatsSummary(stats)).toBe(true)
    expect(isStatsSummary({ ...stats, clipNames: [1] })).toBe(false)
    expect(animationHandler.alsoShows?.(fbx('Goblin.fbx'), stats)).toBe(true)
    expect(animationHandler.alsoShows?.({ ...fbx('Run.anim'), type: 'animation' }, stats)).toBe(false)
  })

  it('finds the character from the Animator Controller that plays the clip (Stack_Idle in Customer.controller)', async () => {
    const g = 'p/Assets/NetCatch/'
    const texts: Record<string, string> = {
      [`${g}Animations/ASMR-Fish/Stack_Idle.anim.meta`]: 'fileFormatVersion: 2\nguid: 731e9ef676f004d5bbccff188f57ce77\n',
      [`${g}Animations/ASMR-Fish/Customer.controller`]: '  m_Motion: {fileID: 7400000, guid: 731e9ef676f004d5bbccff188f57ce77, type: 2}',
      [`${g}Animations/ASMR-Fish/Player.controller`]: '  m_Motion: {fileID: 7400000, guid: 0000000000000000000000000000abcd, type: 2}'
    }
    const paths = [...Object.keys(texts), `${g}Animations/ASMR-Fish/Stack_Idle.anim`, `${g}Models/ASMR-Fish/LP.fbx`, `${g}Models/Customers/Customer_Red.fbx`, `${g}Models/Player/TF_Player.fbx`]
    const byPath = new Map<string, TreeEntry>(paths.map((p) => [p, { path: p, type: 'blob', sha: p }]))
    let reads = 0
    const ctx = { root: 'p/', byPath, readTexts: async (ps: readonly string[]) => ((reads += ps.length), new Map(ps.map((p) => [p, texts[p] ?? '']))) }
    const clip = `${g}Animations/ASMR-Fish/Stack_Idle.anim`
    const controllers = await controllersPlaying(clip, ctx)
    expect(controllers).toEqual([`${g}Animations/ASMR-Fish/Customer.controller`])
    expect(rigCandidates(clip, ctx, 8, controllers)[0]).toBe(`${g}Models/Customers/Customer_Red.fbx`)
    // Controllers are read once per commit: the next clip asks only for its own .meta.
    const before = reads
    await controllersPlaying(clip, ctx)
    expect(reads - before).toBe(1)
  })
})
