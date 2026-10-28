import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../types'
import { parseMaterialLook } from '../unity/yaml'
import { materialHandler } from '../handlers/material'
import type { DepContext } from './fbx'
import { resolveMaterialDependencies } from './material'

const G = (n: number) => n.toString(16).padStart(32, '0')

const urpMat = `%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: M_Rock
  m_Shader: {fileID: 4800000, guid: 933532a4fcc9baf4fa0491de14d08ed7, type: 3}
  m_ValidKeywords:
  - _ALPHATEST_ON
  - _EMISSION
  m_SavedProperties:
    m_TexEnvs:
    - _BaseMap:
        m_Texture: {fileID: 2800000, guid: ${G(3)}, type: 3}
        m_Scale: {x: 1, y: 1}
    - _BumpMap:
        m_Texture: {fileID: 2800000, guid: ${G(4)}, type: 3}
    m_Ints: []
    m_Floats:
    - _AlphaClip: 1
    - _Cutoff: 0.4
    - _Smoothness: 0.25
    - _Surface: 0
    m_Colors:
    - _BaseColor: {r: 0.5, g: 0.25, b: 1, a: 1}
    - _EmissionColor: {r: 1, g: 0, b: 0, a: 1}
  m_BuildTextureStacks: []
`

const unity5Mat = `Material:\r
  m_Name: Old\r
  m_ShaderKeywords: _ALPHABLEND_ON\r
  m_SavedProperties:\r
    m_Floats:\r
    - first:\r
        name: _Mode\r
      second: 3\r
    m_Colors:\r
    - first:\r
        name: _Color\r
      second: {r: 1, g: 1, b: 1, a: 0.5}\r
    - first:\r
        name: _EmissionColor\r
      second: {r: 0, g: 0, b: 0, a: 1}\r
`

function ctxFor(files: Record<string, string>, guids: Record<string, string>): DepContext {
  const byPath = new Map<string, TreeEntry>(Object.keys(files).map((p) => [p, { path: p, type: 'blob', sha: p, size: 100 }]))
  for (const p of Object.values(guids)) {
    byPath.set(p, { path: p, type: 'blob', sha: p, size: 1000 })
    byPath.set(`${p}.meta`, { path: `${p}.meta`, type: 'blob', sha: `${p}.meta`, size: 10 })
  }
  return {
    root: 'proj/',
    byPath,
    pathForGuid: (g) => guids[g],
    pathsByName: () => [],
    readTexts: async (paths) => new Map(paths.filter((p) => p in files).map((p) => [p, files[p]])),
    readBytes: async () => new Uint8Array()
  }
}

describe('parseMaterialLook', () => {
  it('reads colour, cutout, smoothness and emission (URP)', () => {
    expect(parseMaterialLook(urpMat)).toEqual({
      color: { r: 0.5, g: 0.25, b: 1, a: 1 },
      emission: { r: 1, g: 0, b: 0, a: 1 },
      surface: 'cutout',
      cutoff: 0.4,
      smoothness: 0.25,
      metallic: undefined
    })
  })

  it('reads the Unity 5 layout and leaves emission off without its keyword', () => {
    expect(parseMaterialLook(unity5Mat)).toMatchObject({ color: { r: 1, g: 1, b: 1, a: 0.5 }, emission: undefined, surface: 'transparent' })
  })

  it('defaults to opaque when nothing is set', () => {
    expect(parseMaterialLook('Material:\n  m_Name: Empty\n')).toEqual({ surface: 'opaque', color: undefined, emission: undefined, cutoff: undefined, smoothness: undefined, metallic: undefined })
  })
})

describe('resolveMaterialDependencies', () => {
  it('lists the .mat, its textures and its .meta files, even before the GUID index knows the material', async () => {
    const ctx = ctxFor(
      { 'proj/Assets/M/M_Rock.mat': urpMat, 'proj/Assets/M/M_Rock.mat.meta': `fileFormatVersion: 2\nguid: ${G(9)}\n` },
      { [G(3)]: 'proj/Assets/T/Rock.png' }
    )
    const report = await resolveMaterialDependencies('proj/Assets/M/M_Rock.mat', ctx)
    expect(report.materials[0]).toMatchObject({ name: 'M_Rock', guid: G(9), missing: false, shader: { kind: 'package', label: 'Universal Render Pipeline/Lit' } })
    expect(report.materials[0].textures).toEqual([
      expect.objectContaining({ prop: '_BaseMap', path: 'proj/Assets/T/Rock.png', missing: false }),
      expect.objectContaining({ prop: '_BumpMap', missing: true })
    ])
    expect(report.files.sort()).toEqual(['proj/Assets/M/M_Rock.mat', 'proj/Assets/M/M_Rock.mat.meta', 'proj/Assets/T/Rock.png', 'proj/Assets/T/Rock.png.meta'])
    expect(report.warnings).toContain('missingTexture')
  })

  it('still describes a .mat without a .meta, and says so', async () => {
    const report = await resolveMaterialDependencies('proj/Assets/M/M_Rock.mat', ctxFor({ 'proj/Assets/M/M_Rock.mat': urpMat }, { [G(3)]: 'proj/Assets/T/Rock.png' }))
    expect(report.materials[0]).toMatchObject({ name: 'M_Rock', guid: undefined, missing: false })
    expect(report.warnings).toContain('noMeta')
    expect(report.files).toContain('proj/Assets/T/Rock.png')
  })

  it('is what the material handler resolves with', () => {
    expect(materialHandler.match({ path: 'A/M_Rock.MAT', type: 'blob', sha: 'x' })).toBe(true)
    expect(materialHandler.resolveDependencies).toBe(resolveMaterialDependencies)
  })
})

describe('parseMaterialLook (legacy particles)', () => {
  it('doubles _TintColor, which legacy particle shaders treat as 0.5 = neutral', () => {
    const text = 'Material:\n  m_SavedProperties:\n    m_Colors:\n    - _TintColor: {r: 0.5, g: 0.25, b: 0.5, a: 0.5}\n'
    expect(parseMaterialLook(text).color).toEqual({ r: 1, g: 0.5, b: 1, a: 0.5 })
  })
})
