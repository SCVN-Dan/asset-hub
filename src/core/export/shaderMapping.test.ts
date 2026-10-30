import { describe, expect, it } from 'vitest'
import { mapMaterial, materialShader, parseShaderMapping, shaderMapper } from './shaderMapping'

const G = (c: string) => c.repeat(32)

const mat = `%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: Rock
  m_Shader: {fileID: 4800000, guid: ${G('a')}, type: 3}
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _BaseMap:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: ${G('t')}, type: 3}
        m_Scale: {x: 2, y: 2}
        m_Offset: {x: 0, y: 0}
    m_Ints: []
    m_Floats:
    - _Glossiness: 0.5
    m_Colors:
    - _Color: {r: 1, g: 0, b: 0, a: 1}
  m_BuildTextureStacks: []
`

describe('shader mapping', () => {
  it('reads the rules and reports malformed ones', () => {
    expect(parseShaderMapping('{"mappings":[{"from":"Custom/Toon","to":"Universal Render Pipeline/Lit","props":{"_MainTex":"_BaseMap"}},{"from":"x"}]}')).toEqual({
      rules: [{ from: 'Custom/Toon', to: 'Universal Render Pipeline/Lit', props: { _MainTex: '_BaseMap' } }],
      errors: ['.assethub/shader-mapping.json: mapping #2 needs "from", "to" and string "props"']
    })
    expect(parseShaderMapping('{').errors).toHaveLength(1)
    expect(parseShaderMapping('{"rules":[]}').errors).toHaveLength(1)
  })

  it('switches the shader and renames properties, replacing a stale one under the new name', () => {
    const out = mapMaterial(mat, { fileID: '4800000', guid: G('b'), type: '3' }, { _MainTex: '_BaseMap', _Color: '_BaseColor', _Glossiness: '_Smoothness' })
    expect(materialShader(out)).toEqual({ fileID: '4800000', guid: G('b'), type: '3' })
    expect(out).toContain(`    - _BaseMap:\n        m_Texture: {fileID: 2800000, guid: ${G('t')}, type: 3}\n        m_Scale: {x: 2, y: 2}`)
    expect(out.match(/- _BaseMap:/g)).toHaveLength(1)
    expect(out).not.toContain('_MainTex')
    expect(out).toContain('    - _Smoothness: 0.5\n    m_Colors:\n    - _BaseColor: {r: 1, g: 0, b: 0, a: 1}\n  m_BuildTextureStacks: []')
  })

  it('swaps two properties without losing either', () => {
    const out = mapMaterial(mat, { fileID: '4800000', guid: G('a'), type: '3' }, { _MainTex: '_BaseMap', _BaseMap: '_MainTex' })
    expect(out.match(/- _BaseMap:/g)).toHaveLength(1)
    expect(out.match(/- _MainTex:/g)).toHaveLength(1)
  })

  it('matches materials by shader name, GUID or built-in file ID, and resolves the target in the project', () => {
    const project = new Map([
      ['Universal Render Pipeline/Lit', { path: 'Library/PackageCache/urp/Lit.shader', guid: G('b'), kind: 'shader' as const }],
      ['Project/Water', { path: 'Assets/Water.shadergraph', guid: G('c'), kind: 'shadergraph' as const }]
    ])
    const { rules } = parseShaderMapping(
      JSON.stringify({
        mappings: [
          { from: 'Custom/Toon', to: 'Universal Render Pipeline/Lit', props: { _MainTex: '_BaseMap' } },
          { from: 'builtin:46', to: G('c') },
          { from: 'Custom/Old', to: 'Missing/Shader' }
        ]
      })
    )
    const { errors, map } = shaderMapper(rules, project, new Map([[G('a'), 'Custom/Toon']]))
    expect(errors).toEqual(['.assethub/shader-mapping.json: "Missing/Shader" is not a shader of the project'])
    const toon = map(mat)!
    expect([toon.from, toon.to]).toEqual(['Custom/Toon', 'Universal Render Pipeline/Lit'])
    expect(materialShader(toon.text)?.guid).toBe(G('b'))
    const standard = map(mat.replace(/m_Shader: .*/, 'm_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}'))!
    expect(materialShader(standard.text)).toEqual({ fileID: '-6465566751694194690', guid: G('c'), type: '3' })
    expect(map(mat.replace(G('a'), G('d')))).toBeUndefined()
  })
})
