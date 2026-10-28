import { describe, expect, it } from 'vitest'
import { decodePsd, isPsd } from './psd'

/** Minimal PSD: header, empty sections, composite image data. */
function psd(width: number, height: number, channels: number, compression: 0 | 1, planes: number[][]): Uint8Array {
  const parts: number[] = []
  const u16 = (v: number) => parts.push((v >> 8) & 255, v & 255)
  const u32 = (v: number) => parts.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255)
  parts.push(0x38, 0x42, 0x50, 0x53)
  u16(1)
  parts.push(0, 0, 0, 0, 0, 0)
  u16(channels)
  u32(height)
  u32(width)
  u16(8)
  u16(3)
  u32(0)
  u32(0)
  u32(0)
  u16(compression)
  if (compression === 0) planes.forEach((p) => parts.push(...p))
  else {
    // Each row packed as one literal run: [n-1, ...bytes].
    const rows = planes.flatMap((p) => Array.from({ length: height }, (_, y) => p.slice(y * width, (y + 1) * width)))
    rows.forEach((r) => u16(r.length + 1))
    rows.forEach((r) => parts.push(r.length - 1, ...r))
  }
  return new Uint8Array(parts)
}

describe('decodePsd', () => {
  const R = [255, 0, 10, 20]
  const G = [0, 255, 30, 40]
  const B = [0, 0, 50, 60]

  it('decodes raw RGB', () => {
    const img = decodePsd(psd(2, 2, 3, 0, [R, G, B]))!
    expect([img.width, img.height]).toEqual([2, 2])
    expect([...img.data.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('decodes RLE RGBA', () => {
    const A = [255, 128, 64, 0]
    const img = decodePsd(psd(2, 2, 4, 1, [R, G, B, A]))!
    expect([...img.data.slice(8, 16)]).toEqual([10, 30, 50, 64, 20, 40, 60, 0])
  })

  it('handles PackBits repeat runs', () => {
    // One 4-pixel row per channel, written as a repeat run (-3 → 4 copies).
    const parts = [...psd(4, 1, 3, 1, [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]])]
    const head = parts.length - 3 * 2 - 3 * 5 // header + counts start before 3 rows of 5 bytes
    const packed = [...parts.slice(0, head), 0, 2, 0, 2, 0, 2, 253, 1, 253, 2, 253, 3]
    const img = decodePsd(new Uint8Array(packed))!
    expect([...img.data.slice(0, 4)]).toEqual([1, 2, 3, 255])
    expect([...img.data.slice(12, 16)]).toEqual([1, 2, 3, 255])
  })

  it('recognises PSD content regardless of file name', () => {
    expect(isPsd(psd(1, 1, 3, 0, [[1], [2], [3]]))).toBe(true)
    expect(isPsd(new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(30).fill(0)]))).toBe(false)
  })
})
