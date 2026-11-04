import { describe, expect, it } from 'vitest'
import { blenderMaterial, blenderScript, bundleFileNames, modelBundleMaterials, prefabBundleMaterials } from './modelBundle'
import type { DependencyReport, MaterialRef } from '../deps/types'

const mat = (name: string, textures: Array<[string, string]>, extra: Partial<MaterialRef> = {}): MaterialRef => ({
  name,
  missing: false,
  textures: textures.map(([prop, path]) => ({ prop, path, name: path, matchedBy: 'guid', missing: false })),
  ...extra
})
const report = (materials: MaterialRef[]): DependencyReport => ({ kind: 'A', materials, embeddedTextures: [], warnings: [], suggested: [], files: [] })

/** A .mat as Unity writes it, with the given floats and colours. */
const matText = (floats: Record<string, number>, colors: Record<string, string>, keywords = '') => `%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: M
  m_ShaderKeywords: ${keywords}
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs: []
    m_Floats:
${Object.entries(floats).map(([k, v]) => `    - ${k}: ${v}`).join('\n')}
    m_Colors:
${Object.entries(colors).map(([k, v]) => `    - ${k}: ${v}`).join('\n')}
`

describe('modelBundleMaterials', () => {
  it('kind A .mat files go on the FBX material each replaces; a prefab material on all; FBX-named textures where nothing else is', () => {
    const out = modelBundleMaterials(
      report([mat('Body_URP', [['_BaseMap', 'a/base.png'], ['_MaskMap', 'a/m.png'], ['_Weird', 'a/w.asset']], { sourceName: 'Body', path: 'a/Body_URP.mat', shader: { guid: 'x', label: 'Universal Render Pipeline/Lit', kind: 'package' } })]),
      mat('Skin', [['_MainTex', 't/skin.png']], { path: 't/Skin.mat' }),
      ['t/hero_diffuse.png', 't/hero_normal.png', 't/hero_rough.png']
    )
    expect(out).toEqual([
      { target: 'Body', name: 'Body_URP', mat: 'a/Body_URP.mat', shader: 'Universal Render Pipeline/Lit', textures: [{ prop: '_BaseMap', path: 'a/base.png' }, { prop: '_MaskMap', path: 'a/m.png' }] },
      { target: '*', name: 'Skin', mat: 't/Skin.mat', shader: undefined, textures: [{ prop: '_MainTex', path: 't/skin.png' }] },
      { target: '?', textures: [{ prop: '_MainTex', path: 't/hero_diffuse.png' }, { prop: '_BumpMap', path: 't/hero_normal.png' }] }
    ])
  })

  it('a prefab’s materials are named by GUID, as its GLB names them', () => {
    expect(prefabBundleMaterials(report([mat('A', [], { guid: 'g1', path: 'A.mat' }), mat('B', [], { missing: true, guid: 'g2' })]))).toEqual([{ target: 'g1', name: 'A', mat: 'A.mat', shader: undefined, textures: [] }])
  })
})

describe('blenderMaterial', () => {
  const files = (p: string) => p.split('/').pop()

  it('URP Lit: linear tint, metallic map with smoothness in its alpha, cutout', () => {
    const m = { target: 'Body', mat: 'x.mat', textures: [{ prop: '_BaseMap', path: 'a/c.png' }, { prop: '_MetallicGlossMap', path: 'a/mg.png' }, { prop: '_BumpMap', path: 'a/n.png' }] }
    const spec = blenderMaterial(m, matText({ _Smoothness: 0.8, _Metallic: 0, _AlphaClip: 1, _Cutoff: 0.3, _BumpScale: 0.5 }, { _BaseColor: '{r: 0.5, g: 1, b: 0, a: 1}' }), files)
    expect(spec.color[0]).toBeCloseTo(0.214, 3)
    expect(spec).toMatchObject({ colorMap: 'c.png', metallicMap: 'mg.png', normalMap: 'n.png', normalScale: 0.5, smoothness: 0.8, smoothnessFrom: 'map', surface: 'cutout', cutoff: 0.3, unlit: false })
  })

  it('built-in Standard: smoothness from the albedo alpha, scaled by _GlossMapScale; emission only when turned on', () => {
    const m = { target: 'A', mat: 'x.mat', textures: [{ prop: '_MainTex', path: 'c.png' }, { prop: '_EmissionMap', path: 'e.png' }] }
    const off = blenderMaterial(m, matText({ _SmoothnessTextureChannel: 1, _GlossMapScale: 0.6, _Glossiness: 0.2 }, { _EmissionColor: '{r: 1, g: 0, b: 0, a: 1}' }), files)
    expect(off).toMatchObject({ smoothnessFrom: 'albedo', smoothness: 0.6 })
    expect(off.emission).toBeUndefined()
    const on = blenderMaterial(m, matText({}, { _EmissionColor: '{r: 1, g: 0, b: 0, a: 1}' }, '_EMISSION'), files)
    expect(on).toMatchObject({ emission: [1, 0, 0], emissionMap: 'e.png' })
  })

  it('numbers when there are no maps; a texture not in the bundle is left out; unlit shaders', () => {
    const spec = blenderMaterial({ target: 'A', mat: 'x.mat', shader: 'Universal Render Pipeline/Unlit', textures: [{ prop: '_BaseMap', path: 'gone.png' }] }, matText({ _Smoothness: 0.3, _Metallic: 1, _Surface: 1 }, {}), () => undefined)
    expect(spec).toMatchObject({ metallic: 1, smoothness: 0.3, smoothnessFrom: 'value', surface: 'transparent', unlit: true })
    expect(spec.colorMap).toBeUndefined()
  })
})

describe('bundleFileNames', () => {
  it('numbers files that share a name', () => {
    expect([...bundleFileNames(['a/T.png', 'b/t.png', 'c/x.fbx', 'a/T.png']).values()]).toEqual(['T.png', 't_2.png', 'x.fbx'])
  })
})

describe('blenderScript', () => {
  it('embeds the data as a Python string that survives quotes', () => {
    const spec = blenderMaterial({ target: "Bob's", textures: [] }, undefined, () => undefined)
    const py = blenderScript('Hero "v2".glb', [spec])
    const literal = py.match(/json\.loads\((".*")\)/)![1]
    expect(JSON.parse(JSON.parse(literal))).toEqual({ model: 'Hero "v2".glb', materials: [spec], cleanup: false })
  })
})
