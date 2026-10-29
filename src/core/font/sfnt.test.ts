import { describe, expect, it } from 'vitest'
import { fontCoverage, missingChars, parseFont, parseFontMeta } from './sfnt'

/** A minimal font: name, maxp and cmap tables only (enough for what the parser reads). */
function buildFont(opts: { family: string; style: string; glyphs: number; format4?: Array<[number, number]>; format12?: Array<[number, number]>; ttc?: boolean }): Uint8Array {
  const u16 = (n: number) => [(n >> 8) & 255, n & 255]
  const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
  const utf16 = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)))
  const names = [
    [1, opts.family],
    [2, opts.style]
  ] as const
  const strings = names.map(([, s]) => utf16(s))
  let off = 0
  const name = [...u16(0), ...u16(names.length), ...u16(6 + names.length * 12)]
  names.forEach(([id], i) => {
    name.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strings[i].length), ...u16(off))
    off += strings[i].length
  })
  name.push(...strings.flat())
  const maxp = [...u32(0x00005000), ...u16(opts.glyphs)]
  // Format 4 with idDelta mapping every code to glyph 1+, then the 0xFFFF end segment.
  const subtables: number[][] = []
  if (opts.format4) {
    const segs = [...opts.format4, [0xffff, 0xffff] as [number, number]]
    const n = segs.length
    const body = [...segs.flatMap(([, e]) => u16(e)), ...u16(0), ...segs.flatMap(([st]) => u16(st)), ...segs.flatMap(([st]) => u16(st === 0xffff ? 1 : (1 - st) & 0xffff)), ...segs.flatMap(() => u16(0))]
    subtables.push([3, 1, ...[...u16(4), ...u16(14 + body.length), ...u16(0), ...u16(n * 2), ...u16(0), ...u16(0), ...u16(0), ...body]])
  }
  if (opts.format12) {
    const groups = opts.format12.flatMap(([st, e]) => [...u32(st), ...u32(e), ...u32(1)])
    subtables.push([3, 10, ...[...u16(12), ...u16(0), ...u32(16 + groups.length), ...u32(0), ...u32(opts.format12.length), ...groups]])
  }
  const cmap = [...u16(0), ...u16(subtables.length)]
  let sub = 4 + subtables.length * 8
  for (const [pl, enc, ...data] of subtables) {
    cmap.push(...u16(pl), ...u16(enc), ...u32(sub))
    sub += data.length
  }
  for (const [, , ...data] of subtables) cmap.push(...data)
  const tables: Array<[string, number[]]> = [
    ['cmap', cmap],
    ['maxp', maxp],
    ['name', name]
  ]
  const head = opts.ttc ? 12 + 4 : 0
  let at = head + 12 + tables.length * 16
  const out = opts.ttc ? [...[...'ttcf'].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(1), ...u32(head)] : []
  out.push(...u32(0x00010000), ...u16(tables.length), 0, 0, 0, 0, 0, 0)
  for (const [t, d] of tables) {
    out.push(...[...t].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(at), ...u32(d.length))
    at += d.length
  }
  for (const [, d] of tables) out.push(...d)
  return new Uint8Array(out)
}

describe('font files', () => {
  it('reads names, glyph count and a format 4 character map', () => {
    const font = parseFont(buildFont({ family: 'Pixel', style: 'Bold', glyphs: 120, format4: [[0x20, 0x7e]] }))!
    expect(font).toMatchObject({ family: 'Pixel', style: 'Bold', glyphs: 120, outlines: 'truetype' })
    expect(font.codepoints.size).toBe(95)
    expect(fontCoverage(font.codepoints)).toEqual([{ script: 'latin', have: 95, total: 95, full: true }])
  })

  it('prefers format 12 and reads the first font of a collection', () => {
    const font = parseFont(buildFont({ family: 'Gothic', style: 'Regular', glyphs: 12000, format4: [[0x20, 0x7e]], format12: [[0x20, 0x7e], [0xac00, 0xd7a3]], ttc: true }))!
    expect(font.collection).toBe(1)
    expect(font.codepoints.has(0xd7a3)).toBe(true)
    expect(fontCoverage(font.codepoints).map((c) => [c.script, c.full])).toEqual([
      ['latin', true],
      ['korean', true]
    ])
  })

  it('lists Vietnamese letters a font lacks', () => {
    const font = parseFont(buildFont({ family: 'A', style: 'R', glyphs: 1, format4: [[0x20, 0x7e], [0xc0, 0xc3]] }))!
    const vi = fontCoverage(font.codepoints).find((c) => c.script === 'vietnamese')!
    expect(vi.full).toBe(false)
    expect(missingChars(font.codepoints, 'vietnamese', 4)).toBe('ÈÉÊÌ')
  })

  it('rejects other files', () => {
    expect(parseFont(new TextEncoder().encode('not a font at all'))).toBeUndefined()
  })
})

describe('font import settings', () => {
  it('reads the mode, font data and fallbacks', () => {
    const meta = `fileFormatVersion: 2
guid: 0123
TrueTypeFontImporter:
  externalObjects: {}
  serializedVersion: 4
  fontSize: 16
  forceTextureCase: -2
  characterSpacing: 0
  includeFontData: 1
  fontNames:
  - Noto Sans
  - Arial
  fallbackFontReferences: []
  customCharacters:
  fontRenderingMode: 0
  ascentCalculationMode: 1
  fontTextureCase: -2
`
    expect(parseFontMeta(meta)).toEqual({ mode: 'dynamic', includeFontData: true, fontSize: 16, fallbacks: ['Noto Sans', 'Arial'] })
    expect(parseFontMeta(meta.replace('fontTextureCase: -2', 'fontTextureCase: 0').replace('includeFontData: 1', 'includeFontData: 0'))).toMatchObject({ mode: 'ascii', includeFontData: false })
    expect(parseFontMeta('TextureImporter:\n')).toBeUndefined()
  })
})
