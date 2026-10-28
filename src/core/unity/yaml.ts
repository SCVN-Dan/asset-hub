// Minimal readers for the Unity YAML files the resolver needs. Unity's YAML
// is regular enough that targeted regexes are more robust than a full parser
// (it uses custom tags like `--- !u!21 &2100000`).

/** Shaders shipped with Unity itself (built-in extra / default resources). */
export const BUILTIN_SHADER_GUIDS = new Set(['0000000000000000f000000000000000', '0000000000000000e000000000000000'])

/** Package shaders recognised by GUID, so they show a name instead of a hash. */
export const KNOWN_PACKAGE_SHADERS: Record<string, string> = {
  '933532a4fcc9baf4fa0491de14d08ed7': 'Universal Render Pipeline/Lit'
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
    for (const line of block.split('\n')) {
      const p = /^\s*- (\w+):\s*$/.exec(line)
      if (p) {
        prop = p[1]
        continue
      }
      const t = new RegExp(`m_Texture: \\{fileID: (-?\\d+)(?:, guid: (${GUID}))?`).exec(line)
      if (t && prop && t[1] !== '0' && t[2]) textures.push({ prop, guid: t[2] })
    }
  }
  return { name, shader: shaderMatch ? { fileID: shaderMatch[1], guid: shaderMatch[2] } : undefined, textures }
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
