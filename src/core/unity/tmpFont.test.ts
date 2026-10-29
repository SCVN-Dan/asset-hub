import { describe, expect, it } from 'vitest'
import { isTmpFontAsset, parseTmpFont, tmpAtlas } from './tmpFont'

const SOURCE = 'b'.repeat(32)
const FALLBACK = 'c'.repeat(32)

/** Trimmed from a real TextMeshPro 3 font asset: the asset, its legacy block, tables, material and atlas. */
const asset = (mode = 0) => `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: 71c1514a6bd24e1e882cebbe1904ce04, type: 3}
  m_Name: Bakbak SDF
  m_FaceInfo:
    m_FaceIndex: 0
    m_FamilyName: Bakbak One
    m_StyleName: Regular
    m_PointSize: 52
  m_Material: {fileID: 2100000}
  m_SourceFontFileGUID: ${SOURCE}
  m_SourceFontFile: {fileID: 0}
  m_AtlasPopulationMode: ${mode}
  m_GlyphTable:
  - m_Index: 3
  - m_Index: 4
  m_CharacterTable:
  - m_ElementType: 1
    m_Unicode: 65
    m_GlyphIndex: 3
  - m_ElementType: 1
    m_Unicode: 7899
    m_GlyphIndex: 4
  m_AtlasTextures:
  - {fileID: 2800000}
  m_AtlasWidth: 2
  m_AtlasHeight: 2
  m_AtlasPadding: 10
  m_FallbackFontAssetTable:
  - {fileID: 11400000, guid: ${FALLBACK}, type: 2}
  m_fontInfo:
    Name: 
    PointSize: 0
--- !u!21 &2100000
Material:
  m_Name: Bakbak SDF Material
--- !u!28 &2800000
Texture2D:
  m_Name: Bakbak SDF Atlas
  m_Width: 2
  m_Height: 2
  m_TextureFormat: 1
  image data: 4
  _typelessdata: 00ff7f10
`

describe('TextMeshPro font assets', () => {
  it('tells font assets from other .asset files', () => {
    expect(isTmpFontAsset(asset())).toBe(true)
    expect(isTmpFontAsset('--- !u!117 &11700000\nTexture3D:\n  m_Name: uni_shield_dir_SDF\n')).toBe(false)
  })

  it('reads the face, characters, atlas size, source font and fallbacks (not the empty legacy block)', () => {
    expect(parseTmpFont(asset())).toEqual({
      name: 'Bakbak SDF',
      family: 'Bakbak One',
      style: 'Regular',
      pointSize: 52,
      atlasWidth: 2,
      atlasHeight: 2,
      padding: 10,
      dynamic: false,
      characters: [65, 7899],
      sourceFont: SOURCE,
      fallbacks: [FALLBACK]
    })
    expect(parseTmpFont(asset(1))?.dynamic).toBe(true)
  })

  it('decodes the Alpha8 atlas stored in the asset', () => {
    expect(tmpAtlas(asset())).toEqual({ width: 2, height: 2, alpha: new Uint8Array([0, 255, 127, 16]) })
  })
})
