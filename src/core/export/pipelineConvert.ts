// Materials of a URP project made to work in a project without URP: each URP shader
// switched to the built-in shader that does the same job, its properties renamed and
// its surface (opaque, cutout, transparent) set up the way Unity's own material
// editors do — the keywords, blend factors, depth writes and render queue a material
// file must already carry, since nothing runs Unity's editor code on import.
// Shader Graphs and custom shaders have no built-in counterpart: they are left as they are.
//
// GUIDs and file IDs as Unity 2022.3 reports them (AssetDatabase.TryGetGUIDAndLocalFileIdentifier).

import { mapMaterial, materialShader, type ShaderRef } from './shaderMapping'
import { materialKeywords, parseMaterialProps } from '../unity/yaml'

export const URP_SHADERS = {
  lit: '933532a4fcc9baf4fa0491de14d08ed7',
  simpleLit: '8d2bb70cbf9db8d4da26e15b26e74248',
  bakedLit: '0ca6dca7396eb48e5849247ffd444914',
  unlit: '650dd9526735d5b46b79224bc6e94025',
  particlesUnlit: '0406db5a14f94604a8c57ccfbc9f3b46',
  particlesSimpleLit: '8516d7a69675844a7a0b7095af7c46af',
  particlesLit: 'b7839dad95683814aa64166edc107ae2'
} as const

const URP_NAMES: Record<string, string> = {
  [URP_SHADERS.lit]: 'Universal Render Pipeline/Lit',
  [URP_SHADERS.simpleLit]: 'Universal Render Pipeline/Simple Lit',
  [URP_SHADERS.bakedLit]: 'Universal Render Pipeline/Baked Lit',
  [URP_SHADERS.unlit]: 'Universal Render Pipeline/Unlit',
  [URP_SHADERS.particlesUnlit]: 'Universal Render Pipeline/Particles/Unlit',
  [URP_SHADERS.particlesSimpleLit]: 'Universal Render Pipeline/Particles/Simple Lit',
  [URP_SHADERS.particlesLit]: 'Universal Render Pipeline/Particles/Lit'
}

/** Whether a material uses one of URP's own shaders. */
export const isUrpMaterial = (text: string): boolean => !!URP_NAMES[materialShader(text)?.guid ?? '']

const builtin = (fileID: number): ShaderRef => ({ fileID: String(fileID), guid: '0000000000000000f000000000000000', type: '0' })
const BUILTIN = {
  standard: { ref: builtin(46), name: 'Standard' },
  unlitTexture: { ref: builtin(10752), name: 'Unlit/Texture' },
  unlitTransparent: { ref: builtin(10750), name: 'Unlit/Transparent' },
  unlitCutout: { ref: builtin(10751), name: 'Unlit/Transparent Cutout' },
  particlesAdditive: { ref: builtin(200), name: 'Legacy Shaders/Particles/Additive' },
  particlesAlpha: { ref: builtin(203), name: 'Legacy Shaders/Particles/Alpha Blended' },
  particlesMultiply: { ref: builtin(205), name: 'Legacy Shaders/Particles/Multiply' },
  particlesPremultiply: { ref: builtin(207), name: 'Legacy Shaders/Particles/Alpha Blended Premultiply' }
}

/** URP's _Blend: 0 alpha, 1 premultiply, 2 additive, 3 multiply. */
type Blend = 'alpha' | 'premultiply' | 'additive' | 'multiply'
const BLENDS: Blend[] = ['alpha', 'premultiply', 'additive', 'multiply']

/** A URP material for a project without URP; undefined when it does not use a URP shader. */
export function urpToBuiltin(text: string): { text: string; from: string; to: string } | undefined {
  const shader = materialShader(text)
  const from = shader && URP_NAMES[shader.guid]
  if (!shader || !from) return undefined
  const props = parseMaterialProps(text)
  const transparent = props.floats._Surface === 1
  const clip = props.floats._AlphaClip === 1
  const blend = BLENDS[props.floats._Blend ?? 0] ?? 'alpha'
  const hasTexture = (slot: string) => !!props.refs[slot]

  if (shader.guid === URP_SHADERS.lit || shader.guid === URP_SHADERS.simpleLit || shader.guid === URP_SHADERS.bakedLit) {
    let out = mapMaterial(text, BUILTIN.standard.ref, { _BaseMap: '_MainTex', _BaseColor: '_Color', _Smoothness: '_Glossiness' })
    // Standard's modes, set up as its material editor does (StandardShaderGUI.SetupMaterialWithBlendMode).
    const mode = transparent ? (blend === 'premultiply' ? 3 : 2) : clip ? 1 : 0
    const setup = [
      { src: 1, dst: 0, zwrite: 1, queue: -1, keyword: undefined },
      { src: 1, dst: 0, zwrite: 1, queue: 2450, keyword: '_ALPHATEST_ON' },
      { src: 5, dst: 10, zwrite: 0, queue: 3000, keyword: '_ALPHABLEND_ON' },
      { src: 1, dst: 10, zwrite: 0, queue: 3000, keyword: '_ALPHAPREMULTIPLY_ON' }
    ][mode]
    out = setFloats(out, { _Mode: mode, _SrcBlend: setup.src, _DstBlend: setup.dst, _ZWrite: setup.zwrite, _GlossMapScale: props.floats._Smoothness ?? 0.5 })
    const keywords = [
      setup.keyword,
      hasTexture('_BumpMap') ? '_NORMALMAP' : undefined,
      hasTexture('_MetallicGlossMap') ? '_METALLICGLOSSMAP' : undefined,
      materialKeywords(text).includes('_EMISSION') ? '_EMISSION' : undefined
    ].filter((k): k is string => !!k)
    out = setKeywords(out, keywords)
    out = setRenderQueue(out, setup.queue)
    return { text: out, from, to: BUILTIN.standard.name }
  }

  if (shader.guid === URP_SHADERS.unlit) {
    const target = transparent ? BUILTIN.unlitTransparent : clip ? BUILTIN.unlitCutout : BUILTIN.unlitTexture
    let out = mapMaterial(text, target.ref, { _BaseMap: '_MainTex', _BaseColor: '_Color' })
    out = setKeywords(out, [])
    out = setRenderQueue(out, transparent ? 3000 : clip ? 2450 : -1)
    return { text: out, from, to: target.name }
  }

  // Particles: Unity's legacy particle shaders, whose blend is fixed by the shader itself.
  const target = !transparent
    ? BUILTIN.particlesAlpha
    : blend === 'additive'
      ? BUILTIN.particlesAdditive
      : blend === 'multiply'
        ? BUILTIN.particlesMultiply
        : blend === 'premultiply'
          ? BUILTIN.particlesPremultiply
          : BUILTIN.particlesAlpha
  let out = mapMaterial(text, target.ref, { _BaseMap: '_MainTex', _BaseColor: '_TintColor' })
  // The legacy shaders double the tint: half of URP's colour is the same colour.
  const c = props.colors._BaseColor
  if (c) out = setColor(out, '_TintColor', { r: c.r / 2, g: c.g / 2, b: c.b / 2, a: c.a / 2 })
  out = setKeywords(out, [])
  out = setRenderQueue(out, 3000)
  return { text: out, from, to: target.name }
}

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** Sets numbers in m_Floats, adding the ones the material does not have. */
export function setFloats(text: string, values: Record<string, number>): string {
  let out = text
  const missing: string[] = []
  for (const [name, v] of Object.entries(values)) {
    const re = new RegExp(`^(\\s*- ${name}: )-?[\\d.eE+-]+\\s*$`, 'm')
    if (re.test(out)) out = out.replace(re, `$1${fmt(v)}`)
    else missing.push(`- ${name}: ${fmt(v)}`)
  }
  return missing.length ? addToList(out, 'm_Floats', missing) : out
}

function setColor(text: string, name: string, c: { r: number; g: number; b: number; a: number }): string {
  const value = `{r: ${fmt(c.r)}, g: ${fmt(c.g)}, b: ${fmt(c.b)}, a: ${fmt(c.a)}}`
  const re = new RegExp(`^(\\s*- ${name}: )\\{[^}]*\\}\\s*$`, 'm')
  return re.test(text) ? text.replace(re, `$1${value}`) : addToList(text, 'm_Colors', [`- ${name}: ${value}`])
}

/** Adds items to one of m_SavedProperties' lists (also an empty `[]` one), at its items' indent. */
function addToList(text: string, list: string, items: string[]): string {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^\\s*${list}:`).test(l))
  if (at === -1) return text
  const indent = /^(\s*)/.exec(lines[at])![1]
  if (/\[\]\s*$/.test(lines[at])) lines[at] = lines[at].replace(/\s*\[\]\s*$/, '')
  lines.splice(at + 1, 0, ...items.map((i) => `${indent}${i}`))
  return lines.join('\n')
}

/** The keywords a material turns on, in whichever form it keeps them (a list in Unity 2021+, else a string). */
export function setKeywords(text: string, keywords: string[]): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const list = /^(\s*)m_(Valid|Invalid)Keywords:/.exec(line)
    const str = /^(\s*)m_ShaderKeywords:/.exec(line)
    if (!list && !str) {
      out.push(line)
      continue
    }
    const indent = (list ?? str)![1]
    // Skip the entry's own lines: list items, or a long string wrapped onto indented lines.
    while (i + 1 < lines.length && (/^\s*- /.test(lines[i + 1]) && lines[i + 1].startsWith(indent) || (str && /^\s{3,}[A-Za-z0-9_ ]+$/.test(lines[i + 1]) && !/:/.test(lines[i + 1])))) i++
    if (str) out.push(`${indent}m_ShaderKeywords: ${keywords.join(' ')}`)
    else if (list![2] === 'Valid' && keywords.length) out.push(`${indent}m_ValidKeywords:`, ...keywords.map((k) => `${indent}- ${k}`))
    else out.push(`${indent}m_${list![2]}Keywords: []`)
  }
  return out.join('\n')
}

function setRenderQueue(text: string, queue: number): string {
  return text.replace(/^(\s*m_CustomRenderQueue: )-?\d+/m, `$1${queue}`)
}
