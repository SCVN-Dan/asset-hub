import { imageSize } from '@core/checks/playable'
import { baseName } from '@core/index'
import { unwrap } from '../remoteSource'
import type { LiveContext } from '../components/ModelViewer'
import type { TextureFile } from './FbxViewer'

/** Formats three.js can display; others (PSD, EXR…) are listed but not drawn. */
export const DRAWABLE = /\.(png|jpe?g|tga|bmp|gif|webp)$/i
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

/** Downloads one texture from the repo and serves it through a blob URL (revoke it when done). */
export async function fetchTextureFile(live: LiveContext, path: string): Promise<TextureFile | undefined> {
  if (!DRAWABLE.test(path)) return undefined
  try {
    const bytes = unwrap(await window.api.assets.readFile(live.repo, live.branch, path))
    const ext = path.split('.').pop()!.toLowerCase()
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'application/octet-stream' }))
    return { name: baseName(path), url, bytes: bytes.byteLength, ...imageSize(path, bytes) }
  } catch {
    // A texture that fails to download just renders untextured.
    return undefined
  }
}
