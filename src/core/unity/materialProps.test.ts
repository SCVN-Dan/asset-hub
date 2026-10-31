import { describe, expect, it } from 'vitest'
import { parseEmbeddedTexture, parseMaterialProps, shaderDefaults, shaderName } from './yaml'

const MAT = `%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: Portal 1
  m_Shader: {fileID: 4800000, guid: 6eb86e4931b506a408fd1477edec61ea, type: 3}
  m_ValidKeywords:
  - ADDITIVECONFIG_ON
  - SHAPE1DISTORT_ON
  m_InvalidKeywords:
  - _BUILTIN_ALPHATEST_ON
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: 0123456789abcdef0123456789abcdef, type: 3}
        m_Scale: {x: 2, y: 0.5}
        m_Offset: {x: 0.25, y: 0}
    - _MaskTex:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _ColorRampTexGradient:
        m_Texture: {fileID: -8638488460860000577, guid: cb7a93b488543fe4589b6f482d6fe57e,
          type: 2}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Ints: []
    m_Floats:
    - _DstMode: 1
    - _ShapeDistortAmount: 0.5
    m_Colors:
    - _GlowColor: {r: 2, g: 1, b: 0.5, a: 1}
  m_BuildTextureStacks: []
`

describe('material props', () => {
  it('reads keywords, numbers, colours and tiling', () => {
    const p = parseMaterialProps(MAT)
    expect(p.keywords).toEqual(['ADDITIVECONFIG_ON', 'SHAPE1DISTORT_ON'])
    expect(p.floats).toEqual({ _DstMode: 1, _ShapeDistortAmount: 0.5 })
    expect(p.colors._GlowColor).toEqual({ r: 2, g: 1, b: 0.5, a: 1 })
    expect(p.st).toEqual({ _MainTex: [2, 0.5, 0.25, 0], _MaskTex: [1, 1, 0, 0], _ColorRampTexGradient: [1, 1, 0, 0] })
    expect(p.refs).toEqual({
      _MainTex: { fileID: '2800000', guid: '0123456789abcdef0123456789abcdef' },
      // A reference long enough to wrap onto a second line.
      _ColorRampTexGradient: { fileID: '-8638488460860000577', guid: 'cb7a93b488543fe4589b6f482d6fe57e' }
    })
  })

  it('reads keywords kept as one string by older Unity', () => {
    expect(parseMaterialProps('Material:\n  m_ShaderKeywords: GLOW_ON MASK_ON\n').keywords).toEqual(['GLOW_ON', 'MASK_ON'])
  })

  it('reads a shader name and its defaults', () => {
    const shader = `Shader "AllIn1Vfx/AllIn1Vfx"
{
    Properties
    {
        _SrcMode("SrcMode", float) = 5 // 0
        [HDR] _GlowColor("Glow Color", Color) = (1,1,1,1) // 3
        _ShapeContrast("Shape Contrast", Range (0, 10)) = 1 // 7
        [NoScaleOffset] _MainTex("Shape Texture", 2D) = "white" {} // 8
    }
    SubShader { }
}
`
    expect(shaderName(shader)).toBe('AllIn1Vfx/AllIn1Vfx')
    expect(shaderDefaults(shader)).toEqual({ floats: { _SrcMode: 5, _ShapeContrast: 1 }, colors: { _GlowColor: { r: 1, g: 1, b: 1, a: 1 } } })
  })

  it('decodes a gradient saved inside a material', () => {
    const asset = `%YAML 1.1
--- !u!28 &-8638488460860000577
Texture2D:
  m_Name: _ColorRampTexGradientTex
  m_Width: 2
  m_Height: 1
  m_TextureFormat: 4
  m_TextureSettings:
    m_FilterMode: 1
    m_WrapU: 1
  m_ColorSpace: 0
  image data: 8
  _typelessdata: ff00008000ff00ff
--- !u!21 &2100000
Material:
  m_Name: Smoke
`
    const t = parseEmbeddedTexture(asset, '-8638488460860000577')
    expect(t).toMatchObject({ width: 2, height: 1, linear: true, clamp: true, point: false })
    expect([...t!.rgba]).toEqual([255, 0, 0, 128, 0, 255, 0, 255])
    expect(parseEmbeddedTexture(asset, '123')).toBeUndefined()
  })
})
