import { describe, expect, it } from 'vitest'
import { parseUnityMesh } from './mesh'

/** A Unity YAML mesh of one triangle: position and uv0 interleaved, 16-bit indices. */
function triangle(): string {
  const verts = [
    [0, 0, 0, 0, 0],
    [1, 0, 0, 1, 0],
    [0, 2, 0, 0, 1]
  ]
  const bytes = new DataView(new ArrayBuffer(verts.length * 20))
  verts.forEach((v, i) => v.forEach((f, k) => bytes.setFloat32(i * 20 + k * 4, f, true)))
  const hex = [...new Uint8Array(bytes.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const channel = (offset: number, dim: number) => `    - stream: 0\n      offset: ${offset}\n      format: 0\n      dimension: ${dim}\n`
  const empty = channel(0, 0)
  return `%YAML 1.1
--- !u!43 &4300000
Mesh:
  m_Name: Tri
  m_MeshCompression: 0
  m_IndexFormat: 0
  m_IndexBuffer: 000001000200
  m_VertexData:
    serializedVersion: 2
    m_VertexCount: 3
    m_Channels:
${channel(0, 3)}${empty}${empty}${empty}${channel(12, 2)}${empty.repeat(9)}    m_DataSize: 60
    _typelessdata: ${hex}
  m_StreamData:
    path: 
`
}

describe('Unity YAML meshes', () => {
  it('reads positions, uvs and triangles', () => {
    const m = parseUnityMesh(triangle())!
    expect([...m.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0])
    expect([...m.uvs!]).toEqual([0, 0, 1, 0, 0, 1])
    expect(m.normals).toBeUndefined()
    expect([...m.indices]).toEqual([0, 1, 2])
  })

  it('leaves out what it cannot read', () => {
    expect(parseUnityMesh('Material:\n  m_Name: x\n')).toBeUndefined()
    expect(parseUnityMesh(triangle().replace('m_MeshCompression: 0', 'm_MeshCompression: 2'))).toBeUndefined()
    // An index past the last vertex: broken data, not a mesh.
    expect(parseUnityMesh(triangle().replace('m_IndexBuffer: 000001000200', 'm_IndexBuffer: 000001000900'))).toBeUndefined()
  })
})
