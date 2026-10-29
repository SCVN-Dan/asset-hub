import { describe, expect, it } from 'vitest'
import { isYamlAsset, planAgainstTarget, remapGuids, urpMismatch, urpVersion, type TargetIndex } from './target'

const G = (c: string) => c.repeat(32)

const target: TargetIndex = {
  byGuid: new Map([
    [G('a'), 'Assets/Art/Rock.fbx'],
    [G('b'), 'Assets/Art/Rock.mat']
  ]),
  byHash: new Map([['h-tex', { path: 'Assets/Shared/rock_d.png', guid: G('9') }]]),
  hashOf: new Map([
    ['Assets/Art/Rock.fbx', 'h-fbx'],
    ['Assets/Art/Rock.mat', 'h-old-mat']
  ]),
  paths: new Set(['assets/assethub/models/tree.fbx'])
}

describe('package against the target project', () => {
  const files = [
    { path: 'p/Assets/Rock.fbx', guid: G('a'), pathname: 'Assets/AssetHub/Models/Rock.fbx', hash: 'h-fbx' },
    { path: 'p/Assets/Rock.mat', guid: G('b'), pathname: 'Assets/AssetHub/Materials/Rock.mat', hash: 'h-new-mat' },
    { path: 'p/Assets/rock_d.png', guid: G('c'), pathname: 'Assets/AssetHub/Textures/rock_d.png', hash: 'h-tex' },
    { path: 'p/Assets/Tree.fbx', guid: G('d'), pathname: 'Assets/AssetHub/Models/Tree.fbx', hash: 'h-tree' },
    { path: 'p/Assets/Bush.fbx', guid: G('e'), pathname: 'Assets/AssetHub/Models/Bush.fbx', hash: 'h-bush' }
  ]

  it('tells what Unity would do with each file, and reuses identical files under another GUID', () => {
    const plan = planAgainstTarget(files, target, true)
    expect(Object.fromEntries(plan.decisions)).toEqual({
      'p/Assets/Rock.fbx': { action: 'same', existing: 'Assets/Art/Rock.fbx' },
      'p/Assets/Rock.mat': { action: 'overwrite', existing: 'Assets/Art/Rock.mat' },
      'p/Assets/rock_d.png': { action: 'reuse', existing: 'Assets/Shared/rock_d.png', guid: G('9') },
      'p/Assets/Tree.fbx': { action: 'rename', existing: 'Assets/AssetHub/Models/Tree.fbx' },
      'p/Assets/Bush.fbx': { action: 'add' }
    })
    expect([...plan.remap]).toEqual([[G('c'), G('9')]])
  })

  it('imports a second copy when reuse is off', () => {
    const plan = planAgainstTarget(files, target, false)
    expect(plan.decisions.get('p/Assets/rock_d.png')).toEqual({ action: 'add' })
    expect(plan.remap.size).toBe(0)
  })

  it('points references at the project copy, in YAML and .meta text', () => {
    const mat = `%YAML 1.1\n    - _BaseMap:\n        m_Texture: {fileID: 2800000, guid: ${G('c')}, type: 3}\n    - _BumpMap:\n        m_Texture: {fileID: 2800000, guid: ${G('f')}, type: 3}\n`
    const out = remapGuids(mat, new Map([[G('c'), G('9')]]))
    expect(out).toContain(`guid: ${G('9')}`)
    expect(out).toContain(`guid: ${G('f')}`)
    expect(out).not.toContain(`guid: ${G('c')}`)
    expect(isYamlAsset(new TextEncoder().encode(mat))).toBe(true)
    expect(isYamlAsset(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
  })

  it('compares the URP versions of both projects', () => {
    const lock = (v: string) => JSON.stringify({ dependencies: { 'com.unity.render-pipelines.universal': { version: v, depth: 0 } } })
    expect(urpVersion(lock('14.0.8'))).toBe('14.0.8')
    expect(urpVersion(JSON.stringify({ dependencies: { 'com.unity.render-pipelines.universal': '12.1.7' } }))).toBe('12.1.7')
    expect(urpVersion('not json')).toBeUndefined()
    expect(urpMismatch('14.0.8', '14.0.11')).toBe(false)
    expect(urpMismatch('14.0.8', '12.1.7')).toBe(true)
    expect(urpMismatch('14.0.8', undefined)).toBe(true)
    expect(urpMismatch(undefined, '14.0.8')).toBe(false)
  })
})
