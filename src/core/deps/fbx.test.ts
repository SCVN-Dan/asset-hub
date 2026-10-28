import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../types'
import { extractFbxTextureNames, metaGuid, parseFbxMeta, parseMaterial } from '../unity/yaml'
import { closestPath, resolveFbxDependencies, type DepContext } from './fbx'

const G = (n: number) => n.toString(16).padStart(32, '0')
const URP_LIT = '933532a4fcc9baf4fa0491de14d08ed7'

const fbxMetaA = `fileFormatVersion: 2
guid: ${G(1)}
ModelImporter:
  serializedVersion: 22200
  externalObjects:
  - first:
      type: UnityEngine:Material
      assembly: UnityEngine.CoreModule
      name: M_Body
    second: {fileID: 2100000, guid: ${G(2)}, type: 2}
  - first:
      type: UnityEngine:Material
      assembly: UnityEngine.CoreModule
      name: M_Gone
    second: {fileID: 2100000, guid: ${G(99)}, type: 2}
  materials:
    materialImportMode: 2
    materialName: 0
    materialSearch: 1
    materialLocation: 1
`
const fbxMetaB = `fileFormatVersion: 2
guid: ${G(5)}
ModelImporter:
  externalObjects: {}
  materials:
    materialImportMode: 2
    materialLocation: 1
`
const mat = (shaderGuid: string) => `%YAML 1.1
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_Name: M_Body
  m_Shader: {fileID: 4800000, guid: ${shaderGuid}, type: 3}
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _BaseMap:
        m_Texture: {fileID: 2800000, guid: ${G(3)}, type: 3}
        m_Scale: {x: 1, y: 1}
    - _BumpMap:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
    - _EmissionMap:
        m_Texture: {fileID: 2800000, guid: ${G(98)}, type: 3}
    m_Ints: []
    m_Floats:
    - _Cull: 2
`

describe('Unity YAML readers', () => {
  it('reads the GUID of a .meta', () => expect(metaGuid(fbxMetaA)).toBe(G(1)))

  it('reads external materials and import settings from an FBX .meta', () => {
    expect(parseFbxMeta(fbxMetaA)).toEqual({
      externalMaterials: [
        { name: 'M_Body', guid: G(2) },
        { name: 'M_Gone', guid: G(99) }
      ],
      materialImportMode: 2,
      materialLocation: 1
    })
    expect(parseFbxMeta(fbxMetaB).externalMaterials).toEqual([])
  })

  it('reads shader and non-empty texture slots from a .mat', () => {
    expect(parseMaterial(mat(URP_LIT))).toEqual({
      name: 'M_Body',
      shader: { fileID: '4800000', guid: URP_LIT },
      textures: [
        { prop: '_BaseMap', guid: G(3) },
        { prop: '_EmissionMap', guid: G(98) }
      ]
    })
  })

  it('takes the Material name, not the empty name of the URP AssetVersion block before it', () => {
    const urp = `--- !u!114 &-1\nMonoBehaviour:\n  m_Name: \n  version: 9\n--- !u!21 &2100000\nMaterial:\n  m_Name: M_Fish_dirty\n`
    expect(parseMaterial(urp).name).toBe('M_Fish_dirty')
  })

  it('finds texture file names inside FBX bytes, including absolute paths', () => {
    const bytes = new TextEncoder().encode('Kaydara FBX Binary\0\x01RelativeFilename\0Users/artist/Desktop/T_Tree_Albedo.png\0\x05C:\\Art\\bark.TGA\0junk.pngx')
    expect(extractFbxTextureNames(bytes).sort()).toEqual(['T_Tree_Albedo.png', 'bark.TGA'])
  })
})

describe('closestPath', () => {
  it('prefers the deepest shared folder', () => {
    expect(closestPath(['A/Other/t.png', 'A/Hero/Tex/t.png'], 'A/Hero/Hero.fbx')).toBe('A/Hero/Tex/t.png')
  })
})

function ctxFor(files: Record<string, string>, guids: Record<string, string>, bytes: Record<string, Uint8Array> = {}): DepContext {
  const byPath = new Map<string, TreeEntry>(Object.keys({ ...files, ...bytes }).map((p) => [p, { path: p, type: 'blob', sha: p, size: 100 }]))
  for (const p of Object.values(guids)) {
    byPath.set(p, { path: p, type: 'blob', sha: p, size: 1000 })
    byPath.set(`${p}.meta`, { path: `${p}.meta`, type: 'blob', sha: `${p}.meta`, size: 10 })
  }
  return {
    root: 'proj/',
    byPath,
    pathForGuid: (g) => guids[g],
    pathsByName: (n) => [...byPath.keys()].filter((p) => p.split('/').pop()!.toLowerCase() === n.toLowerCase()),
    readTexts: async (paths) => new Map(paths.filter((p) => p in files).map((p) => [p, files[p]])),
    readBytes: async (p) => bytes[p] ?? new Uint8Array()
  }
}

describe('resolveFbxDependencies', () => {
  it('kind A: follows GUIDs to materials, shader and textures, and reports what is missing', async () => {
    const ctx = ctxFor(
      { 'proj/Assets/Hero/Hero.fbx.meta': fbxMetaA, 'proj/Assets/Mats/M_Body.mat': mat(G(7)) },
      { [G(2)]: 'proj/Assets/Mats/M_Body.mat', [G(3)]: 'proj/Assets/Tex/Body.png', [G(7)]: 'proj/Assets/Shaders/Toon.shadergraph' }
    )
    const report = await resolveFbxDependencies('proj/Assets/Hero/Hero.fbx', ctx)
    expect(report.kind).toBe('A')
    expect(report.materials[0]).toMatchObject({ name: 'M_Body', path: 'proj/Assets/Mats/M_Body.mat', missing: false, shader: { kind: 'project', label: 'Toon.shadergraph' } })
    expect(report.materials[0].textures).toEqual([
      expect.objectContaining({ prop: '_BaseMap', path: 'proj/Assets/Tex/Body.png', matchedBy: 'guid', missing: false, size: 1000 }),
      expect.objectContaining({ prop: '_EmissionMap', missing: true })
    ])
    expect(report.materials[1]).toMatchObject({ name: 'M_Gone', missing: true })
    expect(report.warnings.sort()).toEqual(['customShader', 'missingMaterial', 'missingTexture'])
    expect(report.files).toEqual(
      expect.arrayContaining(['proj/Assets/Hero/Hero.fbx', 'proj/Assets/Hero/Hero.fbx.meta', 'proj/Assets/Mats/M_Body.mat', 'proj/Assets/Mats/M_Body.mat.meta', 'proj/Assets/Tex/Body.png.meta', 'proj/Assets/Shaders/Toon.shadergraph'])
    )
  })

  it('labels package and built-in shaders without adding files', async () => {
    const ctx = ctxFor({ 'proj/Assets/Hero/Hero.fbx.meta': fbxMetaA, 'proj/Assets/Mats/M_Body.mat': mat(URP_LIT) }, { [G(2)]: 'proj/Assets/Mats/M_Body.mat' })
    const report = await resolveFbxDependencies('proj/Assets/Hero/Hero.fbx', ctx)
    expect(report.materials[0].shader).toEqual({ guid: URP_LIT, kind: 'package', label: 'Universal Render Pipeline/Lit' })
    expect(report.warnings).not.toContain('customShader')
  })

  it('kind B: matches texture names from inside the FBX to the nearest file', async () => {
    const fbx = new TextEncoder().encode('Kaydara FBX Binary  Users/artist/Desktop/Bark.png  missing_one.png')
    const ctx = ctxFor(
      { 'proj/Assets/Trees/Tree.fbx.meta': fbxMetaB, 'proj/Assets/Trees/Tex/Bark.png': '', 'proj/Assets/Old/Bark.png': '', 'other/Assets/Bark.png': '' },
      {},
      { 'proj/Assets/Trees/Tree.fbx': fbx }
    )
    const report = await resolveFbxDependencies('proj/Assets/Trees/Tree.fbx', ctx)
    expect(report.kind).toBe('B')
    expect(report.embeddedTextures).toEqual([
      expect.objectContaining({ name: 'Bark.png', path: 'proj/Assets/Trees/Tex/Bark.png', matchedBy: 'name', missing: false }),
      expect.objectContaining({ name: 'missing_one.png', missing: true })
    ])
    expect(report.warnings.sort()).toEqual(['missingTexture', 'textureByName'])
  })

  it('suggests .mat files next to an FBX that has no materials, without adding them to the export', async () => {
    const fbx = new TextEncoder().encode('Kaydara FBX Binary')
    const ctx = ctxFor(
      {
        'proj/Assets/Fish/Fish.fbx.meta': fbxMetaB,
        'proj/Assets/Fish/M_Fish_red.mat': mat(URP_LIT),
        'proj/Assets/Fish/M_Fish_red.mat.meta': `guid: ${G(20)}\n`,
        'proj/Assets/Other/M_Car.mat': mat(URP_LIT),
        'proj/Assets/Other/M_Car.mat.meta': `guid: ${G(21)}\n`
      },
      { [G(3)]: 'proj/Assets/Fish/T_Fish.png' },
      { 'proj/Assets/Fish/Fish.fbx': fbx }
    )
    const report = await resolveFbxDependencies('proj/Assets/Fish/Fish.fbx', ctx)
    expect(report.suggested.map((s) => s.material.path)).toEqual(['proj/Assets/Fish/M_Fish_red.mat'])
    expect(report.suggested[0].material.textures[0]).toMatchObject({ prop: '_BaseMap', path: 'proj/Assets/Fish/T_Fish.png' })
    expect(report.suggested[0].files).toContain('proj/Assets/Fish/M_Fish_red.mat.meta')
    expect(report.files).not.toContain('proj/Assets/Fish/M_Fish_red.mat')
  })
})
