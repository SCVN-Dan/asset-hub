// Reads the first image of a TIFF file. Unity imports .tif textures (Photoshop saves them), browsers
// cannot decode them at all. Covers what painting tools write: uncompressed, LZW, Deflate/ZIP and
// PackBits; 8 or 16 bits per sample; grey, grey + alpha, RGB and RGBA; strips or tiles; the
// horizontal predictor. Anything else (CMYK, floating point, JPEG inside TIFF) is left undecoded.
import type { DecodedImage } from './psd'

export function isTiff(bytes: Uint8Array): boolean {
  return bytes.length > 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42))
}

const TAG = {
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  samples: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planar: 284,
  predictor: 317,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339
} as const

/** Decompressed bytes of one strip or tile. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** TIFF's LZW: MSB-first codes, 9 to 12 bits, Clear 256, End 257, widths growing one code early. */
function lzw(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let o = 0
  let bit = 0
  const read = (width: number) => {
    let v = 0
    for (let i = 0; i < width; i++) {
      const byte = data[(bit + i) >> 3] ?? 0
      v = (v << 1) | ((byte >> (7 - ((bit + i) & 7))) & 1)
    }
    bit += width
    return v
  }
  let table: Uint8Array[] = []
  const reset = () => {
    table = []
    for (let i = 0; i < 256; i++) table.push(Uint8Array.of(i))
    table.push(new Uint8Array(0), new Uint8Array(0))
  }
  const put = (s: Uint8Array) => {
    const n = Math.min(s.length, expected - o)
    out.set(s.subarray(0, n), o)
    o += n
  }
  reset()
  let width = 9
  let prev: Uint8Array | undefined
  while (o < expected && bit + width <= data.length * 8) {
    const code = read(width)
    if (code === 257) break
    if (code === 256) {
      reset()
      width = 9
      prev = undefined
      continue
    }
    let entry: Uint8Array
    if (code < table.length) entry = table[code]
    else if (prev) {
      entry = new Uint8Array(prev.length + 1)
      entry.set(prev)
      entry[prev.length] = prev[0]
    } else break
    put(entry)
    if (prev) {
      const added = new Uint8Array(prev.length + 1)
      added.set(prev)
      added[prev.length] = entry[0]
      table.push(added)
    }
    prev = entry
    // "Early change": the width grows when the next code would not fit one code before the limit.
    if (table.length + 1 >= 1 << width && width < 12) width++
  }
  return out
}

function packBits(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let o = 0
  for (let i = 0; i < data.length && o < expected; ) {
    const n = (data[i++] << 24) >> 24
    if (n >= 0) {
      const count = Math.min(n + 1, expected - o)
      out.set(data.subarray(i, i + count), o)
      o += count
      i += n + 1
    } else if (n !== -128) {
      const count = Math.min(1 - n, expected - o)
      out.fill(data[i++], o, o + count)
      o += count
    }
  }
  return out
}

/**
 * The first image of a TIFF as RGBA, or undefined for what is not covered. Async: Deflate goes
 * through the platform's DecompressionStream.
 */
export async function decodeTiff(bytes: Uint8Array): Promise<DecodedImage | undefined> {
  if (!isTiff(bytes)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = bytes[0] === 0x49
  const u16 = (at: number) => view.getUint16(at, le)
  const u32 = (at: number) => view.getUint32(at, le)
  const ifd = u32(4)
  if (ifd + 2 > bytes.length) return undefined
  const tags = new Map<number, number[]>()
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const at = ifd + 2 + i * 12
    const type = u16(at + 2)
    const count = u32(at + 4)
    const size = type === 3 ? 2 : type === 4 ? 4 : 1
    // Values that fit in four bytes sit in the entry; the rest are pointed at.
    const base = count * size <= 4 ? at + 8 : u32(at + 8)
    const values: number[] = []
    for (let k = 0; k < Math.min(count, 1 << 20); k++) values.push(type === 3 ? u16(base + k * 2) : type === 4 ? u32(base + k * 4) : bytes[base + k])
    tags.set(u16(at), values)
  }
  const one = (tag: number, fallback: number) => tags.get(tag)?.[0] ?? fallback
  const width = one(TAG.width, 0)
  const height = one(TAG.height, 0)
  const samples = one(TAG.samples, 1)
  const bits = one(TAG.bits, 1)
  const compression = one(TAG.compression, 1)
  const photometric = one(TAG.photometric, 2)
  const predictor = one(TAG.predictor, 1)
  if (!width || !height || (bits !== 8 && bits !== 16) || one(TAG.planar, 1) !== 1 || one(TAG.sampleFormat, 1) !== 1) return undefined
  if (![0, 1, 2].includes(photometric) || samples < 1 || samples > 4 || (photometric === 2 && samples < 3)) return undefined
  if (![1, 5, 8, 32946, 32773].includes(compression)) return undefined

  const bytesPerSample = bits / 8
  const tiled = tags.has(TAG.tileOffsets)
  const blockW = tiled ? one(TAG.tileWidth, width) : width
  const blockH = tiled ? one(TAG.tileLength, height) : Math.min(one(TAG.rowsPerStrip, height), height)
  const offsets = tags.get(tiled ? TAG.tileOffsets : TAG.stripOffsets) ?? []
  const counts = tags.get(tiled ? TAG.tileByteCounts : TAG.stripByteCounts) ?? []
  const across = Math.ceil(width / blockW)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const rowBytes = blockW * samples * bytesPerSample

  for (let b = 0; b < offsets.length; b++) {
    const raw = bytes.subarray(offsets[b], offsets[b] + (counts[b] ?? 0))
    const expected = rowBytes * blockH
    const block =
      compression === 5 ? lzw(raw, expected) : compression === 8 || compression === 32946 ? await inflate(raw) : compression === 32773 ? packBits(raw, expected) : raw
    // Horizontal predictor: each sample is stored as the difference to the one before it in its row.
    if (predictor === 2) {
      for (let y = 0; y < blockH; y++) {
        const row = y * rowBytes
        if (bytesPerSample === 1) {
          for (let x = samples; x < blockW * samples && row + x < block.length; x++) block[row + x] = (block[row + x] + block[row + x - samples]) & 255
        } else {
          const at = (i: number) => (le ? block[row + i * 2] | (block[row + i * 2 + 1] << 8) : (block[row + i * 2] << 8) | block[row + i * 2 + 1])
          for (let x = samples; x < blockW * samples && row + x * 2 + 1 < block.length; x++) {
            const v = (at(x) + at(x - samples)) & 0xffff
            block[row + x * 2] = le ? v & 255 : v >> 8
            block[row + x * 2 + 1] = le ? v >> 8 : v & 255
          }
        }
      }
    }
    const x0 = tiled ? (b % across) * blockW : 0
    const y0 = tiled ? Math.floor(b / across) * blockH : b * blockH
    for (let y = 0; y < blockH && y0 + y < height; y++) {
      for (let x = 0; x < blockW && x0 + x < width; x++) {
        const s = (y * blockW + x) * samples
        // 16-bit samples keep their high byte.
        const v = (k: number) => (bytesPerSample === 1 ? block[s + k] : block[(s + k) * 2 + (le ? 1 : 0)]) ?? 0
        const d = ((y0 + y) * width + x0 + x) * 4
        if (photometric === 2) {
          rgba[d] = v(0)
          rgba[d + 1] = v(1)
          rgba[d + 2] = v(2)
          rgba[d + 3] = samples > 3 ? v(3) : 255
        } else {
          const g = photometric === 0 ? 255 - v(0) : v(0)
          rgba[d] = rgba[d + 1] = rgba[d + 2] = g
          rgba[d + 3] = samples > 1 ? v(1) : 255
        }
      }
    }
  }
  return { width, height, data: rgba }
}
