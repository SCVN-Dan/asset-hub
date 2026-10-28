import { describe, expect, it } from 'vitest'
import { folderAffinity, modelMaterials } from './prefab'

const G = (n: number) => n.toString(16).padStart(32, '0')
const FISH = G(1)
const OTHER = G(2)
const RED = G(10)
const DIRTY = G(11)
const WOOD = G(12)

// Shaped like FishModel.prefab: skinned meshes, a MeshFilter/MeshRenderer pair and a nested model with overrides.
const prefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Fish_Tuna_A
--- !u!137 &101
SkinnedMeshRenderer:
  m_GameObject: {fileID: 100}
  m_Materials:
  - {fileID: 2100000, guid: ${RED}, type: 2}
  m_Mesh: {fileID: -169009198292248300, guid: ${FISH}, type: 3}
--- !u!137 &201
SkinnedMeshRenderer:
  m_GameObject: {fileID: 200}
  m_Materials:
  - {fileID: 2100000, guid: ${DIRTY}, type: 2}
  m_Mesh: {fileID: -169009198292248300, guid: ${FISH}, type: 3}
--- !u!137 &301
SkinnedMeshRenderer:
  m_GameObject: {fileID: 300}
  m_Materials:
  - {fileID: 2100000, guid: ${DIRTY}, type: 2}
  m_Mesh: {fileID: -169009198292248300, guid: ${FISH}, type: 3}
--- !u!33 &401
MeshFilter:
  m_GameObject: {fileID: 400}
  m_Mesh: {fileID: 4300000, guid: ${OTHER}, type: 3}
--- !u!23 &402
MeshRenderer:
  m_GameObject: {fileID: 400}
  m_Materials:
  - {fileID: 2100000, guid: ${WOOD}, type: 2}
  m_StaticBatchInfo:
--- !u!1001 &500
PrefabInstance:
  m_Modification:
    m_Modifications:
    - target: {fileID: 123, guid: ${G(3)}, type: 3}
      propertyPath: m_Materials.Array.data[0]
      value:
      objectReference: {fileID: 2100000, guid: ${RED}, type: 2}
  m_SourcePrefab: {fileID: 100100000, guid: ${G(3)}, type: 3}
`

describe('modelMaterials', () => {
  it('maps each model to the materials of the renderers using its meshes, most used first', () => {
    expect(modelMaterials(prefab)).toEqual({
      [FISH]: [DIRTY, RED],
      [OTHER]: [WOOD],
      [G(3)]: [RED]
    })
  })

  it('returns nothing for prefabs without meshes', () => {
    expect(modelMaterials('--- !u!1 &1\nGameObject:\n  m_Name: Empty\n')).toEqual({})
  })
})

describe('folderAffinity', () => {
  it('counts distinctive folder names shared with the model', () => {
    const fbx = 'p/Assets/Game/Models/ASMR-Fish/Fish.fbx'
    expect(folderAffinity(fbx, 'p/Assets/Game/Prefabs/ASMR-Fish/FishModel.prefab', 'p/')).toBe(1)
    expect(folderAffinity(fbx, 'p/Assets/Other/Prefabs/Car.prefab', 'p/')).toBe(0)
  })

  it('treats spaces, dashes and underscores in folder names alike, and shared file-name words', () => {
    const fbx = 'p/Assets/Supercent/XP Hero/FBXs/Character/Animal/Fish_Dirty.fbx'
    expect(folderAffinity(fbx, 'p/Assets/Supercent/Creative/XP-Hero/ASMR-Fish/FBXs/Fish/Fish_new.prefab', 'p/')).toBe(2)
    expect(folderAffinity(fbx, 'p/Assets/Supercent/Creative/Level/Car.prefab', 'p/')).toBe(0)
  })
})
