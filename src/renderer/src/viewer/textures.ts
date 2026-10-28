import { imageSize } from '@core/checks/playable'
import { baseName, decodePsd, guessTextureRole, isPsd } from '@core/index'
import { unwrap } from '../remoteSource'
import type { LiveContext } from '../components/ModelViewer'
import type { MaterialSlot, TextureFile } from './FbxViewer'

/** Formats the preview can display (PSD through its own decoder); others (EXR, TIFF…) are listed but not drawn. */
export const DRAWABLE = /\.(png|jpe?g|tga|bmp|gif|webp|psd)$/i
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

async function psdToPng(bytes: Uint8Array): Promise<Blob | undefined> {
  const img = decodePsd(bytes)
  if (!img) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))) ?? undefined
}

/** Downloads one texture from the repo and serves it through a blob URL (revoke it when done). */
export async function fetchTextureFile(live: LiveContext, path: string): Promise<TextureFile | undefined> {
  if (!DRAWABLE.test(path)) return undefined
  try {
    const bytes = unwrap(await window.api.assets.readFile(live.repo, live.branch, path))
    // Judged by content: .psd files, and PSD files saved with a .png name, become PNG for the browser.
    const blob = isPsd(bytes) ? await psdToPng(bytes) : new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream' })
    if (!blob) return undefined
    return { name: baseName(path), url: URL.createObjectURL(blob), bytes: bytes.byteLength, ...imageSize(path, bytes) }
  } catch {
    // A texture that fails to download just renders untextured.
    return undefined
  }
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
