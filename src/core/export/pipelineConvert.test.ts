import { describe, expect, it } from 'vitest'
import { materialShader } from './shaderMapping'
import { setKeywords, urpToBuiltin, URP_SHADERS } from './pipelineConvert'
import { materialKeywords, parseMaterialProps } from '../unity/yaml'

/** A URP material as Unity 2022 saves it. */
function urpMaterial(guid: string, floats: Record<string, number>, keywords: string[] = [], extraTex = ''): string {
  return `%YAML 1.1
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_Name: Wall
  m_Shader: {fileID: 4800000, guid: ${guid}, type: 3}
  m_ValidKeywords:${keywords.length ? keywords.map((k) => `\n  - ${k}`).join('') : ' []'}
  m_InvalidKeywords: []
  m_LightmapFlags: 4
  m_CustomRenderQueue: -1
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _BaseMap:
        m_Texture: {fileID: 2800000, guid: ed0c2c8a99e92e14ba740ac8aa428288, type: 3}
        m_Scale: {x: 1.5, y: 4.5}
        m_Offset: {x: 0, y: 0}${extraTex}
    m_Ints: []
    m_Floats:
${Object.entries(floats)
  .map(([k, v]) => `    - ${k}: ${v}`)
  .join('\n')}
    m_Colors:
    - _BaseColor: {r: 1, g: 0.5, b: 0.25, a: 1}
  m_BuildTextureStacks: []
`
}

describe('URP to built-in', () => {
  it('turns Lit into Standard, renamed and set up per surface', () => {
    const normal = `
    - _BumpMap:
        m_Texture: {fileID: 2800000, guid: 0123456789abcdef0123456789abcdef, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}`
    const r = urpToBuiltin(urpMaterial(URP_SHADERS.lit, { _Surface: 1, _Blend: 0, _Smoothness: 0.3 }, ['_EMISSION', '_SURFACE_TYPE_TRANSPARENT'], normal))!
    expect(r.from).toBe('Universal Render Pipeline/Lit')
    expect(r.to).toBe('Standard')
    expect(materialShader(r.text)).toEqual({ fileID: '46', guid: '0000000000000000f000000000000000', type: '0' })
    const p = parseMaterialProps(r.text)
    expect(p.st._MainTex).toEqual([1.5, 4.5, 0, 0])
    expect(p.colors._Color).toEqual({ r: 1, g: 0.5, b: 0.25, a: 1 })
    // Fade: alpha blending, no depth writes, the transparent queue.
    expect(p.floats).toMatchObject({ _Mode: 2, _SrcBlend: 5, _DstBlend: 10, _ZWrite: 0, _Glossiness: 0.3, _GlossMapScale: 0.3 })
    expect(materialKeywords(r.text).sort()).toEqual(['_ALPHABLEND_ON', '_EMISSION', '_NORMALMAP'])
    expect(r.text).toMatch(/m_CustomRenderQueue: 3000/)
    expect(r.text).not.toMatch(/_BaseMap|_BaseColor|_SURFACE_TYPE_TRANSPARENT/)
  })

  it('makes an opaque or cutout Lit an opaque or cutout Standard', () => {
    const opaque = parseMaterialProps(urpToBuiltin(urpMaterial(URP_SHADERS.simpleLit, { _Surface: 0 }))!.text)
    expect(opaque.floats).toMatchObject({ _Mode: 0, _SrcBlend: 1, _DstBlend: 0, _ZWrite: 1 })
    const cut = urpToBuiltin(urpMaterial(URP_SHADERS.lit, { _Surface: 0, _AlphaClip: 1 }))!
    expect(parseMaterialProps(cut.text).floats._Mode).toBe(1)
    expect(materialKeywords(cut.text)).toEqual(['_ALPHATEST_ON'])
    expect(cut.text).toMatch(/m_CustomRenderQueue: 2450/)
  })

  it('picks the Unlit shader by surface', () => {
    expect(urpToBuiltin(urpMaterial(URP_SHADERS.unlit, { _Surface: 0 }))!.to).toBe('Unlit/Texture')
    expect(urpToBuiltin(urpMaterial(URP_SHADERS.unlit, { _Surface: 0, _AlphaClip: 1 }))!.to).toBe('Unlit/Transparent Cutout')
    const t = urpToBuiltin(urpMaterial(URP_SHADERS.unlit, { _Surface: 1 }))!
    expect(t.to).toBe('Unlit/Transparent')
    expect(materialShader(t.text)?.fileID).toBe('10750')
  })

  it('gives particles the legacy shader of their blend, the tint halved', () => {
    const add = urpToBuiltin(urpMaterial(URP_SHADERS.particlesUnlit, { _Surface: 1, _Blend: 2 }))!
    expect(add.to).toBe('Legacy Shaders/Particles/Additive')
    expect(materialShader(add.text)?.fileID).toBe('200')
    expect(parseMaterialProps(add.text).colors._TintColor).toEqual({ r: 0.5, g: 0.25, b: 0.125, a: 0.5 })
    expect(urpToBuiltin(urpMaterial(URP_SHADERS.particlesLit, { _Surface: 1, _Blend: 1 }))!.to).toBe('Legacy Shaders/Particles/Alpha Blended Premultiply')
    expect(urpToBuiltin(urpMaterial(URP_SHADERS.particlesSimpleLit, { _Surface: 1, _Blend: 3 }))!.to).toBe('Legacy Shaders/Particles/Multiply')
    expect(urpToBuiltin(urpMaterial(URP_SHADERS.particlesUnlit, { _Surface: 0 }))!.to).toBe('Legacy Shaders/Particles/Alpha Blended')
  })

  it('leaves other shaders alone', () => {
    expect(urpToBuiltin(urpMaterial('11111111111111111111111111111111', {}))).toBeUndefined()
  })

  it('rewrites keywords kept as a wrapped string too', () => {
    const old = 'Material:\n  m_ShaderKeywords: _ALPHATEST_ON _EMISSION\n    _NORMALMAP\n  m_LightmapFlags: 4\n'
    expect(setKeywords(old, ['_ALPHABLEND_ON'])).toBe('Material:\n  m_ShaderKeywords: _ALPHABLEND_ON\n  m_LightmapFlags: 4\n')
  })
})
