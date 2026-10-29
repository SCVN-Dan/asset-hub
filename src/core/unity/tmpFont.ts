// TextMeshPro font assets (.asset): the face they were made from, the
// characters they hold and their atlas texture, which Unity stores inside the
// same file (Alpha8, as hex). Both the current format (m_FaceInfo,
// m_CharacterTable) and the old one (m_fontInfo, m_glyphInfoList) are read.

import { refGuid, splitDocs } from './prefabScene'

export interface TmpFontInfo {
  name: string
  family: string
  style: string
  pointSize?: number
  atlasWidth: number
  atlasHeight: number
  padding?: number
  /** Dynamic assets add glyphs at run time from the source font, which then ships too. */
  dynamic: boolean
  /** Unicode code points it has glyphs for. */
  characters: number[]
  /** GUID of the font file it was made from. */
  sourceFont?: string
  /** GUIDs of the font assets it falls back to. */
  fallbacks: string[]
}

/** A TextMeshPro font asset (and not some other .asset with "SDF" in its name). */
export function isTmpFontAsset(yaml: string): boolean {
  return /^ {2}m_(FaceInfo|fontInfo):/m.test(yaml)
}

const num = (text: string, key: string) => {
  const v = Number(new RegExp(`^\\s*${key}: (-?[\\d.]+)`, 'm').exec(text)?.[1])
  return Number.isFinite(v) ? v : undefined
}
const str = (text: string, key: string) => new RegExp(`^\\s*${key}: (.*)$`, 'm').exec(text)?.[1]?.trim()

export function parseTmpFont(yaml: string): TmpFontInfo | undefined {
  if (!isTmpFontAsset(yaml)) return undefined
  const docs = splitDocs(yaml.replace(/\r\n/g, '\n'))
  const asset = docs.find((d) => d.cls === '114' && /^ {2}m_(FaceInfo|fontInfo):/m.test(d.body))?.body ?? ''
  // New assets keep an empty legacy m_fontInfo too: old means no m_FaceInfo.
  const old = !/^ {2}m_FaceInfo:/m.test(asset)
  const characters = old
    ? [...asset.matchAll(/^ {2}- id: (\d+)/gm)].map((m) => Number(m[1]))
    : [...asset.matchAll(/^ {4}m_Unicode: (\d+)/gm)].map((m) => Number(m[1]))
  const fallbackList = /^ {2}(?:m_FallbackFontAssetTable|fallbackFontAssets):\n((?: {2}- .*\n?)*)/m.exec(asset)?.[1] ?? ''
  return {
    name: str(asset, 'm_Name') ?? '',
    family: (old ? str(asset, 'Name') : str(asset, 'm_FamilyName')) ?? '',
    style: (old ? '' : str(asset, 'm_StyleName')) ?? '',
    pointSize: old ? num(asset, 'PointSize') : num(asset, 'm_PointSize'),
    atlasWidth: (old ? num(asset, 'AtlasWidth') : num(asset, 'm_AtlasWidth')) ?? 0,
    atlasHeight: (old ? num(asset, 'AtlasHeight') : num(asset, 'm_AtlasHeight')) ?? 0,
    padding: old ? num(asset, 'Padding') : num(asset, 'm_AtlasPadding'),
    dynamic: num(asset, 'm_AtlasPopulationMode') === 1,
    characters: [...new Set(characters)],
    sourceFont: str(asset, 'm_SourceFontFileGUID')?.match(/^[0-9a-f]{32}$/)?.[0] ?? refGuid(asset, 'm_SourceFontFile_EditorRef')?.guid,
    fallbacks: [...fallbackList.matchAll(/guid: ([0-9a-f]{32})/g)].map((m) => m[1])
  }
}

export interface TmpAtlas {
  width: number
  height: number
  /** One coverage byte per pixel, bottom row first (Unity's order). */
  alpha: Uint8Array
}

/** The first atlas texture stored in the asset, when it is Alpha8 (what TextMeshPro writes). */
export function tmpAtlas(yaml: string): TmpAtlas | undefined {
  for (const d of splitDocs(yaml.replace(/\r\n/g, '\n'))) {
    if (d.cls !== '28') continue
    const width = num(d.body, 'm_Width') ?? 0
    const height = num(d.body, 'm_Height') ?? 0
    // TextureFormat 1 = Alpha8.
    if (num(d.body, 'm_TextureFormat') !== 1 || !width || !height) continue
    const hex = /_typelessdata: ([0-9a-f]*)/.exec(d.body)?.[1] ?? ''
    if (hex.length < width * height * 2) continue
    const alpha = new Uint8Array(width * height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = parseInt(hex.substr(i * 2, 2), 16)
    return { width, height, alpha }
  }
  return undefined
}
