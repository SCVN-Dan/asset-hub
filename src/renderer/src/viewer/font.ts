import type { StatsSummary } from '@core/checks/playable'
import { parseFont, parseFontMeta, type FontImport, type FontInfo } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'

/** A font read from the repo, registered with the page so text can be set in it. */
export interface LoadedFont {
  info: FontInfo
  /** CSS family name it was registered under (unique per load). */
  css: string
  bytes: number
  import?: FontImport
  /** Removes the font from the page. */
  release(): void
}

let serial = 0

/** Reads a font (and its .meta) and makes it usable in CSS and canvas; call `release` when done. */
export async function loadFont(live: LiveContext, path: string, background = false): Promise<LoadedFont> {
  const [bytes, metaText] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path, background).then(unwrap),
    window.api.assets.readFile(live.repo, live.branch, `${path}.meta`, background).then((r) => (r.ok ? new TextDecoder().decode(r.data) : undefined))
  ])
  const info = parseFont(bytes)
  if (!info) throw new Error('Not a TrueType / OpenType font')
  const css = `assethub-font-${++serial}`
  const face = new FontFace(css, bytes.slice().buffer)
  await face.load()
  document.fonts.add(face)
  return { info, css, bytes: bytes.byteLength, import: metaText ? parseFontMeta(metaText) : undefined, release: () => document.fonts.delete(face) }
}

export function fontStats(font: Pick<LoadedFont, 'info' | 'bytes'>): StatsSummary {
  return { triangles: 0, vertices: 0, bones: 0, clips: 0, materials: 0, fileBytes: font.bytes, textureBytes: 0, maxTextureSize: 0, glyphs: font.info.glyphs, source: 'viewer' }
}

/** Grid thumbnail: "Aa" and the family name, set in the font itself. */
export async function renderFontThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const font = await loadFont(live, path, true)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const g = canvas.getContext('2d')!
    g.fillStyle = '#1a1e26'
    g.fillRect(0, 0, 320, 240)
    g.fillStyle = '#e6e9ef'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `96px "${font.css}"`
    g.fillText(sampleGlyphs(font.info), 160, 104, 296)
    g.fillStyle = '#8b93a3'
    g.font = `22px "${font.css}", sans-serif`
    g.fillText(font.info.family || path.slice(path.lastIndexOf('/') + 1), 160, 196, 296)
    return { url: canvas.toDataURL('image/webp', 0.85), stats: fontStats(font) }
  } finally {
    font.release()
  }
}

/** "Aa", or what the font can show instead (a Korean-only or symbol font). */
function sampleGlyphs(info: FontInfo): string {
  if (info.codepoints.has(0x41) && info.codepoints.has(0x61)) return 'Aa'
  if (info.codepoints.has(0xac00)) return '가나'
  const first = [...info.codepoints].filter((c) => c > 0x20).slice(0, 2)
  return String.fromCodePoint(...first)
}
