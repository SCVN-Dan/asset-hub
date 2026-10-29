/** What a TrueType / OpenType font file says about itself. */
export interface FontInfo {
  family: string
  /** Regular, Bold Italic… */
  style: string
  fullName?: string
  version?: string
  /** TrueType outlines (glyf) or CFF (OpenType .otf). */
  outlines: 'truetype' | 'cff'
  glyphs: number
  /** Unicode code points that map to a glyph. */
  codepoints: ReadonlySet<number>
  /** A collection (.ttc): only the first font is read. */
  collection?: number
}

const tag = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))

/** Reads the name, glyph count and character map of a .ttf / .otf / .ttc; undefined when it is not one. */
export function parseFont(bytes: Uint8Array): FontInfo | undefined {
  if (bytes.byteLength < 12) return undefined
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let base = 0
  let collection: number | undefined
  if (tag(v, 0) === 'ttcf') {
    collection = v.getUint32(8)
    base = v.getUint32(12)
  }
  const version = v.getUint32(base)
  if (version !== 0x00010000 && version !== 0x74727565 /* true */ && version !== 0x4f54544f /* OTTO */) return undefined
  const tables = new Map<string, { offset: number; length: number }>()
  const count = v.getUint16(base + 4)
  for (let i = 0; i < count; i++) {
    const at = base + 12 + i * 16
    if (at + 16 > bytes.byteLength) return undefined
    const offset = v.getUint32(at + 8)
    const length = v.getUint32(at + 12)
    if (offset + length <= bytes.byteLength) tables.set(tag(v, at), { offset, length })
  }
  try {
    const names = readNames(v, tables.get('name'))
    const maxp = tables.get('maxp')
    return {
      family: names.get(16) ?? names.get(1) ?? '',
      style: names.get(17) ?? names.get(2) ?? '',
      fullName: names.get(4),
      version: names.get(5),
      outlines: tables.has('CFF ') || tables.has('CFF2') ? 'cff' : 'truetype',
      glyphs: maxp ? v.getUint16(maxp.offset + 4) : 0,
      codepoints: readCmap(v, tables.get('cmap')),
      ...(collection ? { collection } : {})
    }
  } catch {
    // A table pointing past the end of the file.
    return undefined
  }
}

/** Name IDs → strings, preferring Windows English, then any Windows, then Mac Roman. */
function readNames(v: DataView, table: { offset: number } | undefined): Map<number, string> {
  const out = new Map<number, { text: string; rank: number }>()
  if (!table) return new Map()
  const count = v.getUint16(table.offset + 2)
  const strings = table.offset + v.getUint16(table.offset + 4)
  for (let i = 0; i < count; i++) {
    const r = table.offset + 6 + i * 12
    const platform = v.getUint16(r)
    const language = v.getUint16(r + 4)
    const id = v.getUint16(r + 6)
    const length = v.getUint16(r + 8)
    const at = strings + v.getUint16(r + 10)
    let text = ''
    let rank: number
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(v.getUint16(at + j))
      rank = platform === 3 && language === 0x409 ? 3 : 2
    } else if (platform === 1) {
      for (let j = 0; j < length; j++) text += String.fromCharCode(v.getUint8(at + j))
      rank = 1
    } else continue
    if (text && (out.get(id)?.rank ?? 0) < rank) out.set(id, { text: text.trim(), rank })
  }
  return new Map([...out].map(([id, n]) => [id, n.text]))
}

/** Code points with a glyph, from the best Unicode subtable (format 12 for fonts past the BMP, else 4). */
function readCmap(v: DataView, table: { offset: number } | undefined): Set<number> {
  const out = new Set<number>()
  if (!table) return out
  const count = v.getUint16(table.offset + 2)
  let best: { at: number; format: number } | undefined
  for (let i = 0; i < count; i++) {
    const r = table.offset + 4 + i * 8
    const platform = v.getUint16(r)
    const encoding = v.getUint16(r + 2)
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue
    const at = table.offset + v.getUint32(r + 4)
    const format = v.getUint16(at)
    if ((format === 12 || format === 4) && (!best || (format === 12 && best.format !== 12))) best = { at, format }
  }
  if (!best) return out
  if (best.format === 12) {
    const groups = v.getUint32(best.at + 12)
    for (let g = 0; g < groups; g++) {
      const r = best.at + 16 + g * 12
      const start = v.getUint32(r)
      const end = Math.min(v.getUint32(r + 4), 0x10ffff)
      for (let c = start; c <= end; c++) out.add(c)
    }
    return out
  }
  const segs = v.getUint16(best.at + 6) / 2
  const ends = best.at + 14
  const starts = ends + segs * 2 + 2
  const deltas = starts + segs * 2
  const ranges = deltas + segs * 2
  for (let s = 0; s < segs; s++) {
    const end = v.getUint16(ends + s * 2)
    const start = v.getUint16(starts + s * 2)
    const delta = v.getUint16(deltas + s * 2)
    const rangeAt = ranges + s * 2
    const rangeOffset = v.getUint16(rangeAt)
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff
      else {
        const g = v.getUint16(rangeAt + rangeOffset + (c - start) * 2)
        glyph = g === 0 ? 0 : (g + delta) & 0xffff
      }
      if (glyph !== 0) out.add(c)
    }
  }
  return out
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const chars = (s: string) => [...s].map((c) => c.codePointAt(0)!)

/** Scripts a playable is likely to need, each as the characters it takes. */
export const FONT_SCRIPTS = {
  latin: range(0x20, 0x7e),
  vietnamese: [...chars('ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯư'), ...range(0x1ea0, 0x1ef9)],
  korean: range(0xac00, 0xd7a3),
  japanese: range(0x3041, 0x30ff),
  chinese: range(0x4e00, 0x9fff),
  cyrillic: range(0x410, 0x44f),
  // U+0E3B–0E3E are unassigned.
  thai: [...range(0xe01, 0xe3a), ...range(0xe3f, 0xe5b)]
} as const

export type FontScript = keyof typeof FONT_SCRIPTS

/**
 * Hangul syllables in everyday use (KS X 1001 has 2,350): a font with this
 * many is taken as covering Korean even without all 11,172.
 */
const KOREAN_COMMON = 2350

export interface ScriptCoverage {
  script: FontScript
  have: number
  total: number
  /** Enough to set text in it. */
  full: boolean
}

/** Scripts the font has at least some of, and how much. */
export function fontCoverage(codepoints: ReadonlySet<number>): ScriptCoverage[] {
  return (Object.keys(FONT_SCRIPTS) as FontScript[]).flatMap((script) => {
    const list = FONT_SCRIPTS[script]
    const have = list.filter((c) => codepoints.has(c)).length
    if (!have) return []
    const full = script === 'korean' ? have >= KOREAN_COMMON : script === 'chinese' ? have >= 2500 : have === list.length
    return [{ script, have, total: list.length, full }]
  })
}

/** Characters of a script the font lacks (for Vietnamese: the few accented letters missing). */
export function missingChars(codepoints: ReadonlySet<number>, script: FontScript, limit = 24): string {
  return FONT_SCRIPTS[script]
    .filter((c) => !codepoints.has(c))
    .slice(0, limit)
    .map((c) => String.fromCodePoint(c))
    .join('')
}

/** Unity's import settings for a font (TrueTypeFontImporter). */
export interface FontImport {
  /** Dynamic: rendered from the font at run time (the font file is in the build when `includeFontData`). */
  mode: 'dynamic' | 'unicode' | 'ascii' | 'asciiUpper' | 'asciiLower' | 'custom'
  includeFontData: boolean
  fontSize?: number
  /** Fonts Unity falls back to for missing characters. */
  fallbacks: string[]
}

const TEXTURE_CASE: Record<number, FontImport['mode']> = { [-2]: 'dynamic', [-1]: 'unicode', 0: 'ascii', 1: 'asciiUpper', 2: 'asciiLower', 3: 'custom' }

export function parseFontMeta(text: string): FontImport | undefined {
  if (!/TrueTypeFontImporter:/.test(text)) return undefined
  const num = (key: string) => {
    const m = new RegExp(`^\\s*${key}:\\s*(-?\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : undefined
  }
  const fallbacks: string[] = []
  const list = /^(\s*)fontNames:\s*\n((?:\1-\s*.*\n?)*)/m.exec(text)
  if (list) for (const m of list[2].matchAll(/-\s*(.+)/g)) if (m[1].trim()) fallbacks.push(m[1].trim())
  return {
    mode: TEXTURE_CASE[num('fontTextureCase') ?? -2] ?? 'dynamic',
    includeFontData: (num('includeFontData') ?? 1) === 1,
    fontSize: num('fontSize'),
    fallbacks
  }
}
