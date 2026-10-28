/**
 * Format, sample rate and channels from an audio file's header. Web Audio
 * resamples what it decodes, so the source rate has to be read from the file.
 */
export interface AudioHeader {
  format: 'WAV' | 'OGG' | 'MP3' | 'AIFF' | string
  sampleRate?: number
  channels?: number
}

const MP3_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [],
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000] // MPEG 1
]

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

export function audioHeader(name: string, bytes: Uint8Array): AudioHeader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    // Chunks after the RIFF header: find "fmt ".
    for (let i = 12; i + 16 <= bytes.length; ) {
      const size = dv.getUint32(i + 4, true)
      if (ascii(bytes, i, 4) === 'fmt ') return { format: 'WAV', channels: dv.getUint16(i + 10, true), sampleRate: dv.getUint32(i + 12, true) }
      i += 8 + size + (size % 2)
    }
    return { format: 'WAV' }
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') {
    const at = indexOf(bytes, '\x01vorbis', 0, 512)
    if (at >= 0 && at + 16 <= bytes.length) return { format: 'OGG', channels: bytes[at + 11], sampleRate: dv.getUint32(at + 12, true) }
    return { format: 'OGG' }
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'FORM' && /AIF[FC]/.test(ascii(bytes, 8, 4))) return { format: 'AIFF' }
  // MP3: skip an ID3v2 tag, then read the first frame header.
  let i = 0
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'ID3') i = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f)
  for (const end = Math.min(bytes.length - 4, i + 4096); i < end; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[i + 1] >> 3) & 3
    const rate = MP3_RATES[version]?.[(bytes[i + 2] >> 2) & 3]
    if (!rate) continue
    return { format: 'MP3', sampleRate: rate, channels: (bytes[i + 3] >> 6) === 3 ? 1 : 2 }
  }
  return { format: (name.split('.').pop() ?? '').toUpperCase() }
}

function indexOf(bytes: Uint8Array, needle: string, from: number, limit: number): number {
  outer: for (let i = from; i + needle.length <= Math.min(bytes.length, from + limit); i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    return i
  }
  return -1
}
