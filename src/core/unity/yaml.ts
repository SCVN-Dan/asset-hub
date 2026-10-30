// Minimal readers for the Unity YAML files the resolver needs. Unity's YAML
// is regular enough that targeted regexes are more robust than a full parser
// (it uses custom tags like `--- !u!21 &2100000`).

/** Shaders shipped with Unity itself (built-in extra / default resources). */
export const BUILTIN_SHADER_GUIDS = new Set(['0000000000000000f000000000000000', '0000000000000000e000000000000000'])

/** Package shaders recognised by GUID, so they show a name instead of a hash. */
export const KNOWN_PACKAGE_SHADERS: Record<string, string> = {
  '933532a4fcc9baf4fa0491de14d08ed7': 'Universal Render Pipeline/Lit',
  '650dd9526735d5b46b79224bc6e94025': 'Universal Render Pipeline/Unlit',
  '8d2bb70cbf9db8d4da26e15b26e74248': 'Universal Render Pipeline/Simple Lit'
}

/** Built-in shaders by fileID (they share one GUID). */
export const BUILTIN_SHADER_NAMES: Record<string, string> = {
  '46': 'Standard',
  '45': 'Standard (Specular setup)',
  '200': 'Legacy Shaders/Particles/Additive',
  '203': 'Legacy Shaders/Particles/Alpha Blended',
  '210': 'Particles/Standard Surface',
  '211': 'Particles/Standard Unlit',
  '10720': 'Mobile/Particles/Additive',
  '10721': 'Mobile/Particles/Alpha Blended'
}

const GUID = '[0-9a-f]{32}'

export function metaGuid(metaText: string): string | undefined {
  return new RegExp(`^guid: (${GUID})`, 'm').exec(metaText)?.[1]
}

export interface FbxMetaInfo {
  /** Materials remapped to .mat assets (kind A). */
  externalMaterials: Array<{ name: string; guid: string }>
  /** 0 = None, 1 = Legacy, 2 = Import via MaterialDescription. */
  materialImportMode?: number
  /** 0 = external (legacy name search), 1 = embedded in the model. */
  materialLocation?: number
}

export function parseFbxMeta(metaText: string): FbxMetaInfo {
  const externalMaterials: FbxMetaInfo['externalMaterials'] = []
  const re = new RegExp(`type: UnityEngine:Material\\s[\\s\\S]*?name: ([^\\n]*)\\n\\s*second: \\{fileID: -?\\d+, guid: (${GUID})`, 'g')
  for (const m of metaText.matchAll(re)) externalMaterials.push({ name: m[1].trim(), guid: m[2] })
  const num = (key: string) => {
    const v = new RegExp(`^\\s*${key}: (-?\\d+)`, 'm').exec(metaText)?.[1]
    return v === undefined ? undefined : Number(v)
  }
  return { externalMaterials, materialImportMode: num('materialImportMode'), materialLocation: num('materialLocation') }
}

export interface MaterialInfo {
  name?: string
  shader?: { fileID: string; guid: string }
  /** Material Variant parent (Unity 2022+). */
  parentGuid?: string
  /** Texture slots that reference a texture (empty slots are skipped). */
  textures: Array<{ prop: string; guid: string }>
}

export function parseMaterial(matText: string): MaterialInfo {
  // URP materials start with an AssetVersion MonoBehaviour whose m_Name is empty; use the Material's own.
  const materialDoc = matText.slice(Math.max(0, matText.search(/^Material:\s*$/m)))
  const name = /^\s*m_Name: (.*)$/m.exec(materialDoc)?.[1]?.trim() || undefined
  const shaderMatch = new RegExp(`m_Shader: \\{fileID: (-?\\d+), guid: (${GUID})`).exec(matText)
  const textures: MaterialInfo['textures'] = []
  const start = matText.indexOf('m_TexEnvs:')
  if (start !== -1) {
    // The texture block ends where the next property list (m_Ints, m_Floats…) starts.
    const rest = matText.slice(start + 'm_TexEnvs:'.length)
    const end = rest.search(/\n {4}m_\w+:/)
    const block = end === -1 ? rest : rest.slice(0, end)
    let prop: string | undefined
    for (const line of block.split(/\r?\n/)) {
      const p = /^\s*- (\w+):\s*$/.exec(line)
      if (p && p[1] !== 'first') {
        prop = p[1]
        continue
      }
      // Unity 5-era layout: "- first:\n    name: _MainTex\n  second:\n    m_Texture: …"
      const old = /^\s*name: (\w+)\s*$/.exec(line)
      if (old) {
        prop = old[1]
        continue
      }
      const t = new RegExp(`m_Texture: \\{fileID: (-?\\d+)(?:, guid: (${GUID}))?`).exec(line)
      if (t && prop && t[1] !== '0' && t[2]) textures.push({ prop, guid: t[2] })
    }
  }
  const parentGuid = new RegExp(`m_Parent: \\{fileID: -?\\d+, guid: (${GUID})`).exec(matText)?.[1]
  return { name, shader: shaderMatch ? { fileID: shaderMatch[1], guid: shaderMatch[2] } : undefined, parentGuid, textures }
}

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** How a material looks, from its colour and number properties — what a preview can reproduce. */
export interface MaterialLook {
  /** _BaseColor (URP) or _Color (built-in): multiplies the colour texture. */
  color?: Rgba
  /** Only when the material turns emission on. */
  emission?: Rgba
  surface: 'opaque' | 'cutout' | 'transparent'
  /** Alpha clip threshold for a cutout surface. */
  cutoff?: number
  /** 0–1 (_Smoothness in URP, _Glossiness in built-in). */
  smoothness?: number
  metallic?: number
  /** How a transparent surface mixes with what is behind it, when the material says (particles mostly). */
  blend?: 'alpha' | 'premultiply' | 'additive' | 'multiply'
}

/** `- _Prop: value` entries of one m_SavedProperties list (also the Unity 5 `- first: name:` layout). */
function propertyList(matText: string, list: string): Array<[string, string]> {
  const text = matText.replace(/\r\n/g, '\n')
  const start = text.indexOf(`${list}:`)
  if (start === -1) return []
  const rest = text.slice(start + list.length + 1)
  const end = rest.search(/\n {4}m_\w+:|\n[^ \n-]/)
  const block = end === -1 ? rest : rest.slice(0, end)
  const out: Array<[string, string]> = []
  for (const m of block.matchAll(/^\s*- (\w+): (.+)$/gm)) out.push([m[1], m[2].trim()])
  for (const m of block.matchAll(/^\s*name: (\w+)\s*\n\s*second: (.+)$/gm)) out.push([m[1], m[2].trim()])
  return out
}

function parseRgba(v: string): Rgba | undefined {
  const n = (k: string) => Number(new RegExp(`\\b${k}: (-?[\\d.eE+-]+)`).exec(v)?.[1])
  const c = { r: n('r'), g: n('g'), b: n('b'), a: n('a') }
  return Object.values(c).every(Number.isFinite) ? c : undefined
}

const BLEND_MODES = ['alpha', 'premultiply', 'additive', 'multiply'] as const

/** URP's _Blend (0 alpha, 1 premultiply, 2 additive, 3 multiply), else the raw blend factors (_DstBlend One = additive). */
function blendOf(floats: Record<string, number>): MaterialLook['blend'] {
  if (floats._Blend !== undefined && (floats._Surface === 1 || floats._DstBlend !== undefined)) return BLEND_MODES[floats._Blend]
  if (floats._DstBlend === 1) return 'additive'
  if (floats._SrcBlend === 2 && floats._DstBlend === 0) return 'multiply'
  if (floats._DstBlend === 10) return floats._SrcBlend === 1 ? 'premultiply' : 'alpha'
  return undefined
}

const BLEND_FACTORS: Record<string, MaterialLook['blend']> = {
  'srcalpha one': 'additive',
  'one one': 'additive',
  'oneminusdstcolor one': 'additive',
  'srcalpha oneminussrcalpha': 'alpha',
  'one oneminussrcalpha': 'premultiply',
  'dstcolor zero': 'multiply',
  'zero srccolor': 'multiply',
  'dstcolor srccolor': 'multiply'
}

/**
 * The blend a shader's code sets (`Blend SrcAlpha One`…), when fixed there.
 * Undefined when it comes from material properties (`Blend [_SrcBlend] [_DstBlend]`)
 * or is not one a preview tells apart: the material's numbers then decide.
 */
export function shaderBlend(shaderText: string): MaterialLook['blend'] {
  const code = shaderText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const m = /^\s*Blend\s+(\w+)\s+(\w+)/im.exec(code)
  return m ? BLEND_FACTORS[`${m[1]} ${m[2]}`.toLowerCase()] : undefined
}

/**
 * The texture slots a shader declares: `_MainTex ("Albedo", 2D)` in a
 * .shader's Properties — the ones its code samples first, in that order
 * (packs keep a "Particle Texture" _MainTex they never read) — and Texture2D
 * properties (by reference name) in a Shader Graph, whose old format nests
 * them as escaped JSON, hence the optional backslashes.
 */
export function shaderTextureProps(path: string, text: string): string[] {
  if (/\.shadergraph$/i.test(path)) {
    const out: string[] = []
    for (const m of text.matchAll(/Texture2DShaderProperty/g)) {
      const block = text.slice(m.index, m.index + 4000).split(/\\?"m_Type\\?"|\\?"typeInfo\\?"/)[0]
      const ref = (key: string) => new RegExp(`\\\\?"${key}\\\\?":\\s*\\\\?"(\\w*)`).exec(block)?.[1]
      const name = ref('m_OverrideReferenceName') || ref('m_DefaultReferenceName')
      if (name && !out.includes(name)) out.push(name)
    }
    return out
  }
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const props = /Properties\s*\{([\s\S]*?)\n\s*\}/.exec(code)?.[1] ?? ''
  const declared = [...props.matchAll(/(_\w+)\s*\(\s*"[^"]*"\s*,\s*2D\s*\)/g)].map((m) => m[1])
  const sampled = [...code.matchAll(/(?:tex2D\w*|SAMPLE_TEXTURE2D\w*)\s*\(\s*(_\w+)|(_\w+)\.Sample\w*\s*\(/g)].map((m) => m[1] ?? m[2])
  const read = [...new Set(sampled.filter((p) => declared.includes(p)))]
  return [...read, ...declared.filter((p) => !read.includes(p))]
}

export function parseMaterialLook(matText: string): MaterialLook {
  const colors: Record<string, Rgba> = {}
  for (const [k, v] of propertyList(matText, 'm_Colors')) {
    const c = parseRgba(v)
    if (c) colors[k] = c
  }
  const floats: Record<string, number> = {}
  for (const [k, v] of [...propertyList(matText, 'm_Ints'), ...propertyList(matText, 'm_Floats')]) {
    const n = Number(v)
    if (Number.isFinite(n)) floats[k] = n
  }
  // Keywords are a string (m_ShaderKeywords) or a list (m_ValidKeywords), depending on the Unity version.
  const emissive = /_EMISSION\b/.test(/m_ShaderKeywords:.*$/m.exec(matText)?.[0] ?? '') || /m_ValidKeywords:(?:\s*\n\s*- \w+)*?\s*\n\s*- _EMISSION\s*$/m.test(matText)
  // URP: _Surface 0 opaque / 1 transparent, _AlphaClip for cutout. Built-in Standard: _Mode 0 opaque, 1 cutout, 2 fade, 3 transparent.
  const surface: MaterialLook['surface'] =
    floats._Surface === 1 || floats._Mode === 2 || floats._Mode === 3 ? 'transparent' : floats._AlphaClip === 1 || floats._Mode === 1 ? 'cutout' : 'opaque'
  return {
    // Legacy particle shaders double _TintColor (0.5 grey is neutral).
    color: colors._BaseColor ?? colors._Color ?? (colors._TintColor && { ...colors._TintColor, r: colors._TintColor.r * 2, g: colors._TintColor.g * 2, b: colors._TintColor.b * 2 }),
    emission: emissive ? colors._EmissionColor : undefined,
    surface,
    cutoff: surface === 'cutout' ? floats._Cutoff : undefined,
    smoothness: floats._Smoothness ?? floats._Glossiness,
    metallic: floats._Metallic,
    ...(blendOf(floats) ? { blend: blendOf(floats) } : {})
  }
}

const IMAGE_EXT = /\.(png|jpe?g|tga|psd|tiff?|exr|bmp|gif|hdr)$/i

/** File-name references to textures inside an FBX (binary or ASCII), e.g. from absolute paths on the artist's machine. */
export function extractFbxTextureNames(bytes: Uint8Array): string[] {
  // latin1 keeps every byte, so ASCII strings inside the binary survive intact.
  const text = new TextDecoder('latin1').decode(bytes)
  const names = new Set<string>()
  for (const m of text.matchAll(/[A-Za-z0-9_ .()\-/\\:]{1,240}?\.(?:png|jpe?g|tga|psd|tiff?|exr|bmp|gif|hdr)(?![A-Za-z0-9])/gi)) {
    const base = m[0].split(/[\\/]/).pop()?.trim()
    if (base && IMAGE_EXT.test(base) && base.length > 4) names.add(base)
  }
  return [...names]
}

export type TextureRole = 'color' | 'normal' | 'emission'

/**
 * What a texture is for, judged from its file name — for FBX files that list
 * textures without saying which material slot they belong to.
 */
export function guessTextureRole(fileName: string): TextureRole | undefined {
  const n = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  if (/(normal|nrm|norm|_n$|_nm$|bump)/.test(n)) return 'normal'
  if (/(emiss|emit|glow|_e$)/.test(n)) return 'emission'
  if (/(diffuse|albedo|basecolou?r|base_colou?r|colou?r|_d$|_bc$|_c$|_col$|_diff$|maintex)/.test(n)) return 'color'
  // Masks, roughness, metallic, AO… are not drawn by the preview.
  return undefined
}

/** Import settings of a texture, from its .meta (TextureImporter). */
export interface TextureImport {
  /** 0 Default, 1 Normal map, 2 Editor GUI, 4 Cookie, 6 Lightmap, 7 Cursor, 8 Sprite, 10 Single channel. */
  textureType?: number
  /** Largest size Unity imports at, for the default platform. */
  maxTextureSize?: number
  /** 0 None, 1 Normal quality, 2 High quality, 3 Low quality. */
  compression?: number
  sRGB?: boolean
  mipmaps?: boolean
  alphaIsTransparency?: boolean
  /** Where alpha comes from: the file's own channel, none (opaque), or made from the colour's grey level. */
  alphaSource?: 'none' | 'input' | 'gray'
  /** Per-platform overrides that are switched on. */
  overrides: Array<{ target: string; maxTextureSize?: number; compression?: number }>
}

/** TextureImporter alphaUsage: 0 None, 1 Input Texture Alpha, 2 From Gray Scale. */
const ALPHA_SOURCES: Record<number, TextureImport['alphaSource']> = { 0: 'none', 1: 'input', 2: 'gray' }

export function parseTextureMeta(metaText: string): TextureImport {
  const text = metaText.replace(/\r\n/g, '\n')
  const platformStart = text.search(/^\s*platformSettings:/m)
  const head = platformStart < 0 ? text : text.slice(0, platformStart)
  const num = (src: string, key: string) => {
    const v = new RegExp(`^\\s*${key}: (-?\\d+)`, 'm').exec(src)?.[1]
    return v === undefined ? undefined : Number(v)
  }
  const flag = (src: string, key: string) => {
    const v = num(src, key)
    return v === undefined ? undefined : v !== 0
  }
  const blocks = platformStart < 0 ? [] : text.slice(platformStart).split(/^\s*- (?=serializedVersion|buildTarget)/m).slice(1)
  const platforms = blocks.map((b) => ({
    target: /buildTarget: (\S+)/.exec(b)?.[1] ?? '',
    maxTextureSize: num(b, 'maxTextureSize'),
    compression: num(b, 'textureCompression'),
    overridden: flag(b, 'overridden') ?? false
  }))
  const defaults = platforms.find((p) => p.target === 'DefaultTexturePlatform')
  return {
    textureType: num(head, 'textureType'),
    maxTextureSize: defaults?.maxTextureSize ?? num(head, 'maxTextureSize'),
    compression: defaults?.compression ?? num(head, 'textureCompression'),
    sRGB: flag(head, 'sRGBTexture'),
    mipmaps: flag(head, 'enableMipMap'),
    alphaIsTransparency: flag(head, 'alphaIsTransparency'),
    ...(ALPHA_SOURCES[num(head, 'alphaUsage') ?? -1] ? { alphaSource: ALPHA_SOURCES[num(head, 'alphaUsage')!] } : {}),
    overrides: platforms.filter((p) => p.overridden && p.target !== 'DefaultTexturePlatform').map(({ target, maxTextureSize, compression }) => ({ target, maxTextureSize, compression }))
  }
}

/** Size a texture ends up at in a build: its larger side, capped by the import max size (a platform override wins). */
export function importedTextureSize(width: number, height: number, imp: TextureImport, platforms: readonly string[] = ['WebGL', 'Android', 'iPhone']): number {
  const side = Math.max(width, height)
  const override = imp.overrides.find((o) => platforms.includes(o.target) && o.maxTextureSize)
  const cap = override?.maxTextureSize ?? imp.maxTextureSize
  return cap ? Math.min(side, cap) : side
}

/** One set of audio import settings (the default, or a platform's override). */
export interface AudioImportSettings {
  /** 0 Decompress On Load, 1 Compressed In Memory, 2 Streaming. */
  loadType?: number
  /** 0 PCM, 1 Vorbis, 2 ADPCM, 3 MP3, 7 AAC… */
  compressionFormat?: number
  /** 0–1, for Vorbis / MP3. */
  quality?: number
  /** 0 Preserve, 1 Optimize, 2 Override (sampleRateOverride). */
  sampleRateSetting?: number
  sampleRateOverride?: number
}

/** Import settings of an audio clip, from its .meta (AudioImporter). */
export interface AudioImport extends AudioImportSettings {
  forceToMono?: boolean
  preload?: boolean
  loadInBackground?: boolean
  /** Per-platform overrides, by platform name. */
  overrides: Array<AudioImportSettings & { target: string }>
}

/** platformSettingOverrides are keyed by BuildTargetGroup number. */
const AUDIO_PLATFORMS: Record<string, string> = { '1': 'Standalone', '4': 'iPhone', '7': 'Android', '13': 'WebGL' }

function audioSettings(block: string): AudioImportSettings {
  const num = (key: string) => {
    const v = new RegExp(`^\\s*${key}: (-?[\\d.]+)`, 'm').exec(block)?.[1]
    return v === undefined ? undefined : Number(v)
  }
  return {
    loadType: num('loadType'),
    compressionFormat: num('compressionFormat'),
    quality: num('quality'),
    sampleRateSetting: num('sampleRateSetting'),
    sampleRateOverride: num('sampleRateOverride')
  }
}

export function parseAudioMeta(metaText: string): AudioImport {
  const text = metaText.replace(/\r\n/g, '\n')
  const defaults = /^ {2}defaultSettings:\n((?: {4}.*\n?)*)/m.exec(text)?.[1] ?? ''
  const overridesBlock = /^ {2}platformSettingOverrides:\n((?: {4}.*\n?)*)/m.exec(text)?.[1] ?? ''
  const overrides = overridesBlock
    .split(/^ {4}(?=\S)/m)
    .slice(1)
    .map((b) => {
      const id = /^(\S+):/.exec(b)?.[1] ?? ''
      return { target: AUDIO_PLATFORMS[id] ?? id, ...audioSettings(b) }
    })
  // Top-level flags sit at two spaces, outside defaultSettings.
  const flag = (key: string) => {
    const v = new RegExp(`^ {2}${key}: (\\d+)`, 'm').exec(text)?.[1]
    return v === undefined ? undefined : v !== '0'
  }
  return { ...audioSettings(defaults), forceToMono: flag('forceToMono'),
    // Newer importers keep preloadAudioData inside defaultSettings.
    preload: flag('preloadAudioData') ?? (/preloadAudioData: (\d+)/.exec(defaults) ? !/preloadAudioData: 0/.test(defaults) : undefined), loadInBackground: flag('loadInBackground'), overrides }
}

/** Settings a build uses: the first matching platform override, else the defaults. */
export function effectiveAudioImport(imp: AudioImport, platforms: readonly string[] = ['WebGL', 'Android', 'iPhone']): AudioImportSettings {
  const override = platforms.map((p) => imp.overrides.find((o) => o.target === p)).find(Boolean)
  return override ?? imp
}

/**
 * Rough size of a clip in a build, from its length and import settings —
 * what matters for playables, not the source file (a 2 MB WAV may build to
 * 150 KB of Vorbis). Compressed bitrates are estimates.
 */
export function builtAudioBytes(seconds: number, sourceRate: number, sourceChannels: number, imp: AudioImport | undefined): number {
  const s = imp ? effectiveAudioImport(imp) : undefined
  const rate = s?.sampleRateSetting === 2 && s.sampleRateOverride ? Math.min(sourceRate, s.sampleRateOverride) : sourceRate
  const channels = imp?.forceToMono ? 1 : sourceChannels
  // Unity's default for a new clip is Vorbis at 100%.
  const format = s?.compressionFormat ?? 1
  if (format === 0) return seconds * rate * channels * 2
  if (format === 2) return (seconds * rate * channels) / 2
  const kbps = (48 + 208 * (s?.quality ?? 1)) * (channels === 1 ? 0.6 : 1)
  return (seconds * kbps * 1000) / 8
}

/** 9-slice border in pixels (Unity stores it as x = left, y = bottom, z = right, w = top). */
export interface SpriteBorder {
  left: number
  bottom: number
  right: number
  top: number
}

/** One sprite cut from a texture; the rect is in pixels from the bottom-left corner, as Unity stores it. */
export interface SpriteRect {
  name: string
  x: number
  y: number
  width: number
  height: number
  border?: SpriteBorder
}

/** Sprite settings of a texture imported as Sprite (2D and UI), from its .meta. */
export interface SpriteImport {
  /** 1 Single, 2 Multiple (a sheet), 3 Polygon. */
  mode: number
  pixelsPerUnit?: number
  /** Single mode: the whole texture's 9-slice border. */
  border?: SpriteBorder
  /** Multiple mode: the sprites cut from the sheet. */
  sprites: SpriteRect[]
  /** Legacy sprite packer tag. */
  packingTag?: string
}

function parseBorder(line: string | undefined): SpriteBorder | undefined {
  const m = /\{x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+), w: (-?[\d.]+)\}/.exec(line ?? '')
  if (!m) return undefined
  const [left, bottom, right, top] = m.slice(1).map(Number)
  return left || bottom || right || top ? { left, bottom, right, top } : undefined
}

/** Undefined when the texture is not imported as a sprite. */
export function parseSpriteMeta(metaText: string): SpriteImport | undefined {
  const text = metaText.replace(/\r\n/g, '\n')
  if (/^\s*textureType: (\d+)/m.exec(text)?.[1] !== '8') return undefined
  const num = (src: string, key: string) => {
    const v = new RegExp(`^\\s*${key}: (-?[\\d.]+)`, 'm').exec(src)?.[1]
    return v === undefined ? undefined : Number(v)
  }
  // Each sheet entry starts with "- serializedVersion" at the sprites list's indent; nested lists sit deeper.
  const list = /^( *)sprites:\n((?:\1 {0,2}- [\s\S]*?))(?=^\1\w)/m.exec(text)
  const sprites: SpriteRect[] = []
  if (list) {
    const indent = list[1]
    for (const entry of list[2].split(new RegExp(`^${indent} {0,2}- `, 'm')).slice(1)) {
      const name = /^\s*name: (.*)$/m.exec(entry)?.[1]?.trim()
      const rect = /rect:\n([\s\S]*?height: [\d.]+)/.exec(entry)?.[1] ?? ''
      const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((k) => num(rect, k))
      if (name === undefined || width === undefined || height === undefined) continue
      sprites.push({ name, x: x ?? 0, y: y ?? 0, width, height, border: parseBorder(/^\s*border: (.*)$/m.exec(entry)?.[1]) })
    }
  }
  return {
    mode: num(text, 'spriteMode') ?? 1,
    pixelsPerUnit: num(text, 'spritePixelsToUnits'),
    border: parseBorder(/^\s*spriteBorder: (.*)$/m.exec(text)?.[1]),
    sprites,
    packingTag: /^\s*spritePackingTag: (\S.*)$/m.exec(text)?.[1]?.trim() || undefined
  }
}
