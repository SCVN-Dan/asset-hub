/**
 * Meshes Unity saves as YAML (`.mesh`, or a Mesh inside an `.asset`): effect packs ship
 * their waves, rings and slashes this way. Read from the vertex data and index buffer
 * stored as hex; compressed meshes and data in a separate stream file are not.
 */

export interface UnityMesh {
  /** x, y, z per vertex, in Unity's axes. */
  positions: Float32Array
  normals?: Float32Array
  /** First UV set. */
  uvs?: Float32Array
  /** Triangles, from every sub-mesh. */
  indices: Uint32Array
}

/** VertexFormat (Unity 2019+): bytes per component and how to read one. */
const FORMATS: Array<{ size: number; read(v: DataView, at: number): number }> = [
  { size: 4, read: (v, at) => v.getFloat32(at, true) },
  { size: 2, read: (v, at) => half(v.getUint16(at, true)) },
  { size: 1, read: (v, at) => v.getUint8(at) / 255 },
  { size: 1, read: (v, at) => Math.max(-1, v.getInt8(at) / 127) },
  { size: 2, read: (v, at) => v.getUint16(at, true) / 65535 },
  { size: 2, read: (v, at) => Math.max(-1, v.getInt16(at, true) / 32767) },
  { size: 1, read: (v, at) => v.getUint8(at) },
  { size: 1, read: (v, at) => v.getInt8(at) },
  { size: 2, read: (v, at) => v.getUint16(at, true) },
  { size: 2, read: (v, at) => v.getInt16(at, true) },
  { size: 4, read: (v, at) => v.getUint32(at, true) },
  { size: 4, read: (v, at) => v.getInt32(at, true) }
]

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16))

/** The first Mesh in a YAML asset; undefined when it holds none or keeps its data elsewhere. */
export function parseUnityMesh(assetText: string): UnityMesh | undefined {
  const text = assetText.replace(/\r\n/g, '\n')
  const start = text.search(/^Mesh:\s*$/m)
  if (start === -1) return undefined
  const num = (key: string, from = start) => Number(new RegExp(`^\\s*${key}: (-?\\d+)`, 'm').exec(text.slice(from))?.[1])
  if (num('m_MeshCompression') > 0) return undefined
  const vertexAt = text.indexOf('m_VertexData:', start)
  const count = num('m_VertexCount', vertexAt)
  const data = hexBytes(/_typelessdata: ([0-9a-f]*)/.exec(text.slice(vertexAt))?.[1] ?? '')
  if (!(count > 0) || !data.length) return undefined

  // Channels in order: position, normal, tangent, color, uv0…uv7, blend weights, blend indices.
  const channelsText = text.slice(text.indexOf('m_Channels:', vertexAt), text.indexOf('m_DataSize:', vertexAt))
  const channels = [...channelsText.matchAll(/stream: (\d+)\s*\n\s*offset: (\d+)\s*\n\s*format: (\d+)\s*\n\s*dimension: (\d+)/g)].map((m) => ({ stream: +m[1], offset: +m[2], format: +m[3], dim: +m[4] & 0xf }))
  // Each stream is interleaved; streams follow one another, each starting on a 16-byte boundary.
  const strides: number[] = []
  for (const c of channels) if (c.dim) strides[c.stream] = Math.max(strides[c.stream] ?? 0, c.offset + c.dim * (FORMATS[c.format]?.size ?? 4))
  const streamStart: number[] = []
  let at = 0
  for (let s = 0; s < strides.length; s++) {
    streamStart[s] = at
    at += Math.ceil(((strides[s] ?? 0) * count) / 16) * 16
  }
  const view = new DataView(data.buffer)
  const read = (ch: number, comps: number): Float32Array | undefined => {
    const c = channels[ch]
    const fmt = c && FORMATS[c.format]
    if (!c || !c.dim || !fmt) return undefined
    const out = new Float32Array(count * comps)
    for (let i = 0; i < count; i++)
      for (let k = 0; k < Math.min(comps, c.dim); k++) {
        const byte = streamStart[c.stream] + i * strides[c.stream] + c.offset + k * fmt.size
        if (byte + fmt.size > data.length) return undefined
        out[i * comps + k] = fmt.read(view, byte)
      }
    return out
  }
  const positions = read(0, 3)
  if (!positions) return undefined

  const wide = num('m_IndexFormat') === 1
  const ib = hexBytes(/m_IndexBuffer: ([0-9a-f]*)/.exec(text.slice(start))?.[1] ?? '')
  const iv = new DataView(ib.buffer)
  const indices = new Uint32Array(Math.floor(ib.length / (wide ? 4 : 2)))
  for (let i = 0; i < indices.length; i++) indices[i] = wide ? iv.getUint32(i * 4, true) : iv.getUint16(i * 2, true)
  if (!indices.length || indices.some((i) => i >= count)) return undefined
  return { positions, normals: read(1, 3), uvs: read(4, 2), indices }
}
