// Reads the flattened (composite) image every PSD stores after its layers.
// Unity projects often use .psd textures, and sometimes PSD files carry a
// .png name — Unity reads them by content, browsers cannot decode them at all.

export interface DecodedImage {
  width: number
  height: number
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8ClampedArray
}

export function isPsd(bytes: Uint8Array): boolean {
  return bytes.length > 26 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53 // "8BPS"
}

/** PackBits, as used for PSD scanlines. */
function unpackBits(src: Uint8Array, start: number, length: number, out: Uint8Array, outStart: number, outLength: number): void {
  let i = start
  let o = outStart
  const end = start + length
  const outEnd = outStart + outLength
  while (i < end && o < outEnd) {
    const n = (src[i++] << 24) >> 24
    if (n >= 0) {
      const count = Math.min(n + 1, outEnd - o, end - i)
      out.set(src.subarray(i, i + count), o)
      i += n + 1
      o += count
    } else if (n !== -128) {
      const count = Math.min(1 - n, outEnd - o)
      out.fill(src[i++], o, o + count)
      o += count
    }
  }
}

/**
 * Composite image of an 8- or 16-bit RGB or grayscale PSD (not PSB), raw or
 * RLE compressed. Returns undefined for anything else (CMYK, 32-bit, ZIP…).
 */
export function decodePsd(bytes: Uint8Array): DecodedImage | undefined {
  if (!isPsd(bytes)) return undefined
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint16(4) !== 1) return undefined // version 2 is PSB
  const channels = dv.getUint16(12)
  const height = dv.getUint32(14)
  const width = dv.getUint32(18)
  const depth = dv.getUint16(22)
  const mode = dv.getUint16(24) // 1 grayscale, 3 RGB
  if ((depth !== 8 && depth !== 16) || (mode !== 1 && mode !== 3) || !width || !height) return undefined

  let pos = 26
  for (let section = 0; section < 3; section++) {
    // Color mode data, image resources, layer and mask info: skip each by its length.
    if (pos + 4 > bytes.length) return undefined
    pos += 4 + dv.getUint32(pos)
  }
  if (pos + 2 > bytes.length) return undefined
  const compression = dv.getUint16(pos)
  pos += 2

  const bpc = depth / 8
  const rowBytes = width * bpc
  const planeBytes = rowBytes * height
  const planes = Math.min(channels, mode === 3 ? 4 : 2)
  const raw = new Uint8Array(planeBytes * planes)
  if (compression === 0) {
    raw.set(bytes.subarray(pos, pos + raw.length))
  } else if (compression === 1) {
    // Byte counts for every scanline of every channel come first.
    const counts = pos
    let data = pos + channels * height * 2
    for (let c = 0; c < channels; c++) {
      for (let y = 0; y < height; y++) {
        const len = dv.getUint16(counts + (c * height + y) * 2)
        if (c < planes) unpackBits(bytes, data, len, raw, c * planeBytes + y * rowBytes, rowBytes)
        data += len
      }
    }
  } else return undefined

  const out = new Uint8ClampedArray(width * height * 4)
  const sample = (plane: number, i: number) => raw[plane * planeBytes + i * bpc] // 16-bit: high byte
  for (let i = 0; i < width * height; i++) {
    const r = sample(0, i)
    out[i * 4] = r
    out[i * 4 + 1] = mode === 3 ? sample(1, i) : r
    out[i * 4 + 2] = mode === 3 ? sample(2, i) : r
    out[i * 4 + 3] = planes > (mode === 3 ? 3 : 1) ? sample(mode === 3 ? 3 : 1, i) : 255
  }
  return { width, height, data: out }
}
