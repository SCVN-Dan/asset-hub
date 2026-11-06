import { imageSize } from '@core/checks/playable'
import { baseName, decodePsd, decodeTiff, guessTextureRole, isPsd, isTiff, parseTextureMeta, type DependencyReport, type MaterialRef, type TextureImport } from '@core/index'
import { unwrap } from '../remoteSource'
import type { LiveContext } from '../components/ModelViewer'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import type { MaterialSlot, TextureFile } from './FbxViewer'

import { DRAWABLE } from './formats'

export { DRAWABLE }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

/** PSD and TIFF (which browsers cannot read) decoded by us, as PNG for the browser. */
async function psdToPng(bytes: Uint8Array): Promise<Blob | undefined> {
  const img = isTiff(bytes) ? await decodeTiff(bytes) : decodePsd(bytes)
  if (!img) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))) ?? undefined
}

type AlphaSource = TextureImport['alphaSource']

/**
 * A picture with the alpha Unity gives it on import: "From Gray Scale" makes
 * it from the mean of red, green and blue (effect sheets drawn white on
 * black), "None" makes it opaque. Anything else keeps the file's own alpha.
 */
export async function applyAlphaSource(bitmap: ImageBitmap, source: AlphaSource): Promise<ImageBitmap> {
  if (source !== 'gray' && source !== 'none') return bitmap
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const g = canvas.getContext('2d')!
  g.drawImage(bitmap, 0, 0)
  const pixels = g.getImageData(0, 0, bitmap.width, bitmap.height)
  const d = pixels.data
  for (let i = 0; i < d.length; i += 4) d[i + 3] = source === 'gray' ? Math.round((d[i] + d[i + 1] + d[i + 2]) / 3) : 255
  bitmap.close()
  return createImageBitmap(pixels)
}

/** Where a texture's alpha comes from, by its .meta. */
async function alphaSourceOf(live: LiveContext, path: string, background: boolean): Promise<AlphaSource> {
  const r = await window.api.assets.readFile(live.repo, live.branch, `${path}.meta`, background)
  return r.ok ? parseTextureMeta(new TextDecoder().decode(r.data)).alphaSource : undefined
}

/** Downloads one texture from the repo and serves it through a blob URL (revoke it when done), with the alpha Unity imports it with. */
export async function fetchTextureFile(live: LiveContext, path: string, background = false): Promise<TextureFile | undefined> {
  if (!DRAWABLE.test(path)) return undefined
  try {
    const [bytes, source] = await Promise.all([window.api.assets.readFile(live.repo, live.branch, path, background).then(unwrap), alphaSourceOf(live, path, background).catch(() => undefined)])
    // Judged by content: .psd files, and PSD files saved with a .png name, become PNG for the browser.
    let blob = isPsd(bytes) || isTiff(bytes) ? await psdToPng(bytes) : new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream' })
    if (blob && (source === 'gray' || source === 'none')) {
      const bitmap = await applyAlphaSource(await createImageBitmap(blob), source)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      blob = await canvas.convertToBlob({ type: 'image/png' })
    }
    if (!blob) return undefined
    return { name: baseName(path), url: URL.createObjectURL(blob), bytes: bytes.byteLength, ...imageSize(path, bytes) }
  } catch {
    // A texture that fails to download just renders untextured.
    return undefined
  }
}

/** A texture a .mat puts in a slot of a material, by repo path (not downloaded yet). */
export interface SlotPath {
  material: string
  prop: string
  path: string
}

/** Texture slots of one .mat, applied to the material named `material` (`*` for all). */
export function materialSlotPaths(m: MaterialRef, material: string): SlotPath[] {
  return m.textures.filter((tex) => tex.path).map((tex) => ({ material, prop: tex.prop ?? '', path: tex.path! }))
}

/** Kind A slots go to the FBX material the .mat replaces (its name inside the FBX), not the .mat's own name. */
export function reportSlotPaths(report: DependencyReport | undefined): SlotPath[] {
  return report?.kind === 'A' ? report.materials.flatMap((m) => materialSlotPaths(m, m.sourceName ?? m.name)) : []
}

const ROLE_PROP = { color: '_BaseMap', normal: '_BumpMap', emission: '_EmissionMap' } as const

/**
 * Slots for textures an FBX names without saying which material slot they
 * belong to (the model loads untextured): the role is guessed from the file
 * name and applied to every material.
 */
export function guessedSlots(files: readonly TextureFile[]): MaterialSlot[] {
  const slots: MaterialSlot[] = []
  for (const file of files) {
    const role = guessTextureRole(file.name) ?? (files.length === 1 ? 'color' : undefined)
    if (role) slots.push({ material: '*', prop: ROLE_PROP[role], file })
  }
  return slots
}

/** A decoded image ready to draw, with what the texture panel reports about it. */
export interface DecodedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** Some pixel is not fully opaque. */
  hasAlpha: boolean
  format: string
}

/** Format by content (a PSD saved as .png is still a PSD), else by extension. */
function formatOf(path: string, bytes: Uint8Array): string {
  if (isPsd(bytes)) return 'PSD'
  if (isTiff(bytes)) return 'TIFF'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'PNG'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'JPEG'
  return (path.split('.').pop() ?? '').toUpperCase()
}

/** Samples the image for transparency on a small copy (enough to tell, cheap for large textures). */
function sampleAlpha(bitmap: ImageBitmap): boolean {
  const w = Math.min(128, bitmap.width)
  const h = Math.min(128, bitmap.height)
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  g.drawImage(bitmap, 0, 0, w, h)
  const px = g.getImageData(0, 0, w, h).data
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true
  return false
}

/** Decodes PNG / JPEG / GIF / BMP / WebP through the browser, PSD, TIFF and TGA through our own decoders. */
export async function decodeImage(path: string, bytes: Uint8Array, alphaSource?: AlphaSource): Promise<DecodedImage> {
  const format = formatOf(path, bytes)
  let bitmap: ImageBitmap
  if (format === 'PSD') {
    const img = decodePsd(bytes)
    if (!img) throw new Error('Unsupported PSD')
    bitmap = await createImageBitmap(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height))
  } else if (format === 'TIFF') {
    const img = await decodeTiff(bytes)
    if (!img) throw new Error('Unsupported TIFF (CMYK, floating point or JPEG inside)')
    bitmap = await createImageBitmap(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height))
  } else if (format === 'TGA') {
    // parse() returns raw pixel data (typed as a texture in three's typings).
    const tga = new TGALoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) as unknown as {
      data: Uint8Array
      width: number
      height: number
      flipY?: boolean
    }
    const data = new Uint8ClampedArray(tga.data.buffer, tga.data.byteOffset, tga.width * tga.height * 4) as Uint8ClampedArray<ArrayBuffer>
    bitmap = await createImageBitmap(new ImageData(data, tga.width, tga.height), { imageOrientation: tga.flipY ? 'flipY' : 'from-image' })
  } else {
    if (!DRAWABLE.test(path) && format !== 'PNG' && format !== 'JPEG') throw new Error(`${format} cannot be previewed`)
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]))
  }
  // Shown with the alpha Unity imports it with.
  bitmap = await applyAlphaSource(bitmap, alphaSource)
  return { bitmap, width: bitmap.width, height: bitmap.height, hasAlpha: sampleAlpha(bitmap), format }
}
