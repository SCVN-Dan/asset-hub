import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../types'
import { fbxMeshNames, parsePrefabScene } from '../unity/prefabScene'
import type { DepContext, GuidKind } from './fbx'
import { resolvePrefabDependencies } from './prefab'

// Not starting with zeros: those are Unity's built-in resources.
const G = (n: number) => `a${n.toString(16).padStart(31, '0')}`

const house = `%YAML 1.1
--- !u!1 &100
GameObject:
  m_Name: House
  m_IsActive: 1
--- !u!4 &400
Transform:
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 401}
  m_Father: {fileID: 0}
--- !u!114 &500
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: ${G(20)}, type: 3}
--- !u!114 &501
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: ${G(21)}, type: 3}
  sound: {fileID: 8300000, guid: ${G(30)}, type: 3}
--- !u!1 &101
GameObject:
  m_Name: Roof
  m_IsActive: 0
--- !u!4 &401
Transform:
  m_GameObject: {fileID: 101}
  m_LocalRotation: {x: 0, y: 0.7071068, z: 0, w: 0.7071068}
  m_LocalPosition: {x: 1, y: 2, z: 3}
  m_LocalScale: {x: 2, y: 2, z: 2}
  m_Children: []
  m_Father: {fileID: 400}
--- !u!33 &3300
MeshFilter:
  m_GameObject: {fileID: 101}
  m_Mesh: {fileID: 4300000, guid: ${G(1)}, type: 3}
--- !u!23 &2300
MeshRenderer:
  m_GameObject: {fileID: 101}
  m_Materials:
  - {fileID: 2100000, guid: ${G(2)}, type: 2}
  - {fileID: 2100000, guid: ${G(3)}, type: 2}
--- !u!1001 &9000
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 400}
    m_Modifications:
    - target: {fileID: -8679921383154817045, guid: ${G(5)}, type: 3}
      propertyPath: m_LocalPosition.x
      value: 4
      objectReference: {fileID: 0}
    - target: {fileID: -8679921383154817045, guid: ${G(5)}, type: 3}
      propertyPath: m_LocalPosition.y
      value: 0
      objectReference: {fileID: 0}
    - target: {fileID: -8679921383154817045, guid: ${G(5)}, type: 3}
      propertyPath: m_LocalPosition.z
      value: -1
      objectReference: {fileID: 0}
    - target: {fileID: 777, guid: ${G(5)}, type: 3}
      propertyPath: m_Materials.Array.data[0]
      value: 
      objectReference: {fileID: 2100000, guid: ${G(3)}, type: 2}
  m_SourcePrefab: {fileID: 100100000, guid: ${G(5)}, type: 3}
--- !u!4 &402 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: -8679921383154817045, guid: ${G(5)}, type: 3}
  m_PrefabInstance: {fileID: 9000}
`

const chimney = `--- !u!1 &1
GameObject:
  m_Name: Chimney
--- !u!4 &4
Transform:
  m_GameObject: {fileID: 1}
  m_Father: {fileID: 0}
--- !u!33 &33
MeshFilter:
  m_GameObject: {fileID: 1}
  m_Mesh: {fileID: 4300002, guid: ${G(1)}, type: 3}
--- !u!198 &198
ParticleSystem:
  m_GameObject: {fileID: 1}
`

describe('parsePrefabScene', () => {
  it('reads the transform tree, meshes with their materials, instances with overrides, scripts and references', () => {
    const scene = parsePrefabScene(house)
    expect(scene.nodes.get('400')).toMatchObject({ name: 'House', parent: undefined, active: true })
    expect(scene.nodes.get('401')).toMatchObject({ name: 'Roof', parent: '400', position: [1, 2, 3], rotation: [0, 0.7071068, 0, 0.7071068], scale: [2, 2, 2], active: false })
    expect(scene.nodes.get('402')).toMatchObject({ instance: '9000' })
    expect(scene.meshes).toEqual([{ node: '401', mesh: { fileID: '4300000', guid: G(1) }, materials: [G(2), G(3)], skinned: false }])
    expect(scene.instances).toEqual([{ id: '9000', source: G(5), parent: '400', position: [4, 0, -1], rotation: undefined, scale: undefined, materials: [G(3)], name: undefined }])
    expect(scene.scripts).toEqual([G(20), G(21)])
    expect(scene.guids).toContain(G(30))
  })

  it('names meshes from the .meta tables when they are listed', () => {
    const meta = 'ModelImporter:\n  internalIDToNameTable:\n  - first:\n      43: 4300000\n    second: Roof\n  fileIDToRecycleName:\n    4300002: Chimney\n'
    expect([...fbxMeshNames(meta)]).toEqual([
      ['4300000', 'Roof'],
      ['4300002', 'Chimney']
    ])
  })
})

function ctxFor(files: Record<string, string>, guids: Record<string, string>): DepContext & { asked: Array<[GuidKind, string[]]> } {
  const byPath = new Map<string, TreeEntry>()
  for (const p of [...Object.keys(files), ...Object.values(guids)]) {
    byPath.set(p, { path: p, type: 'blob', sha: p, size: 1000 })
    byPath.set(`${p}.meta`, { path: `${p}.meta`, type: 'blob', sha: `${p}.meta`, size: 10 })
  }
  const asked: Array<[GuidKind, string[]]> = []
  return {
    asked,
    root: 'proj/',
    byPath,
    pathForGuid: (g) => guids[g],
    prepare: async (g, kind) => void (g.length && asked.push([kind, [...g]])),
    pathsByName: () => [],
    readTexts: async (paths) => new Map(paths.filter((p) => p in files).map((p) => [p, files[p]])),
    readBytes: async () => new Uint8Array()
  }
}

describe('resolvePrefabDependencies', () => {
  it('follows models, nested prefabs, materials, custom scripts and other assets into the export', async () => {
    const ctx = ctxFor(
      {
        'proj/Assets/House.prefab': house,
        'proj/Assets/Chimney.prefab': chimney,
        'proj/Assets/M/Roof.mat': 'Material:\n  m_Name: Roof\n',
        'proj/Assets/M/Wall.mat': 'Material:\n  m_Name: Wall\n'
      },
      {
        [G(1)]: 'proj/Assets/Models/House.fbx',
        [G(2)]: 'proj/Assets/M/Roof.mat',
        [G(3)]: 'proj/Assets/M/Wall.mat',
        [G(5)]: 'proj/Assets/Chimney.prefab',
        [G(20)]: 'proj/Assets/Scripts/Door.cs',
        [G(30)]: 'proj/Assets/Audio/Knock.wav'
      }
    )
    const report = await resolvePrefabDependencies('proj/Assets/House.prefab', ctx)
    expect(report.parts?.map((p) => [p.kind, p.name, p.uses])).toEqual([
      ['model', 'House.fbx', 2],
      ['prefab', 'Chimney.prefab', 1],
      ['script', 'Door.cs', 1],
      ['other', 'Knock.wav', 1]
    ])
    // The package script (G(21)) is left out: not in the repo, nothing to carry — but the target project needs it.
    expect(report.packageScripts).toEqual([G(21)])
    expect(report.materials.map((m) => m.name)).toEqual(['Roof', 'Wall'])
    expect(report.files).toEqual(
      expect.arrayContaining(['proj/Assets/House.prefab', 'proj/Assets/Chimney.prefab.meta', 'proj/Assets/Models/House.fbx', 'proj/Assets/M/Wall.mat', 'proj/Assets/Scripts/Door.cs', 'proj/Assets/Audio/Knock.wav'])
    )
    expect(report.warnings).toEqual(expect.arrayContaining(['customScript', 'particles']))
    expect(report.guidPaths?.[G(5)]).toBe('proj/Assets/Chimney.prefab')
    expect(ctx.asked.map(([k]) => k)).toEqual(expect.arrayContaining(['model', 'prefab', 'script', 'material', 'texture']))
  })

  it('exports particle materials with their textures, and lists the emitters', async () => {
    const fx = `--- !u!1 &1
GameObject:
  m_Name: Sparks
--- !u!198 &198
ParticleSystem:
  m_GameObject: {fileID: 1}
  lengthInSec: 1
  looping: 0
--- !u!199 &199
ParticleSystemRenderer:
  m_GameObject: {fileID: 1}
  m_Enabled: 1
  m_Materials:
  - {fileID: 2100000, guid: ${G(40)}, type: 2}
  m_RenderMode: 0
`
    const mat = `Material:
  m_Name: Spark
  m_SavedProperties:
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: ${G(41)}, type: 3}
`
    const report = await resolvePrefabDependencies(
      'proj/Assets/FX/Sparks.prefab',
      ctxFor({ 'proj/Assets/FX/Sparks.prefab': fx, 'proj/Assets/FX/Spark.mat': mat }, { [G(40)]: 'proj/Assets/FX/Spark.mat', [G(41)]: 'proj/Assets/FX/spark.png' })
    )
    expect(report.materials.map((m) => m.name)).toEqual(['Spark'])
    expect(report.files).toEqual(expect.arrayContaining(['proj/Assets/FX/Spark.mat', 'proj/Assets/FX/spark.png', 'proj/Assets/FX/spark.png.meta']))
    expect(report.particles).toEqual([expect.objectContaining({ name: 'Sparks', material: G(40), renderMode: 'billboard' })])
  })

  it('reports models that are not in the repo', async () => {
    const report = await resolvePrefabDependencies('proj/Assets/Chimney.prefab', ctxFor({ 'proj/Assets/Chimney.prefab': chimney }, {}))
    expect(report.parts).toEqual([expect.objectContaining({ kind: 'model', missing: true })])
    expect(report.warnings).toContain('missingModel')
  })
})
