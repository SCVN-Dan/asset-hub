export interface TarFile {
  name: string
  data: Uint8Array
}

const BLOCK = 512
const enc = new TextEncoder()

function writeString(buf: Uint8Array, offset: number, length: number, value: string): void {
  buf.set(enc.encode(value).subarray(0, length), offset)
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  writeString(buf, offset, length, value.toString(8).padStart(length - 1, '0') + '\0')
}

function header(name: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(BLOCK)
  const bytes = enc.encode(name)
  if (bytes.length > 100) throw new Error(`Tar entry name too long: ${name}`)
  h.set(bytes, 0)
  writeOctal(h, 100, 8, 0o644) // mode
  writeOctal(h, 108, 8, 0) // uid
  writeOctal(h, 116, 8, 0) // gid
  writeOctal(h, 124, 12, size)
  writeOctal(h, 136, 12, mtime)
  h.fill(0x20, 148, 156) // checksum is computed with this field as spaces
  h[156] = 0x30 // typeflag '0': regular file
  writeString(h, 257, 6, 'ustar\0')
  writeString(h, 263, 2, '00')
  let sum = 0
  for (const b of h) sum += b
  writeString(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
  return h
}

/** Uncompressed POSIX ustar archive of regular files. */
export function tar(files: readonly TarFile[], mtime = Math.floor(Date.now() / 1000)): Uint8Array {
  let total = BLOCK * 2 // two zero blocks end the archive
  for (const f of files) total += BLOCK + Math.ceil(f.data.length / BLOCK) * BLOCK
  const out = new Uint8Array(total)
  let pos = 0
  for (const f of files) {
    out.set(header(f.name, f.data.length, mtime), pos)
    pos += BLOCK
    out.set(f.data, pos)
    pos += Math.ceil(f.data.length / BLOCK) * BLOCK
  }
  return out
}
