import type { StatsSummary } from '@core/checks/playable'
import { importedTextureSize, parseTextureMeta, type MaterialRef } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import type { MaterialSlot, TextureFile } from './FbxViewer'
import { fetchTextureFile } from './textures'

/** One texture of a material, downloaded, with the size it is built at. */
export interface MaterialTexture {
  path: string
  file: TextureFile
  /** Larger side after the import max size in its .meta. */
  built: number
}

/**
 * Downloads the drawable textures a material uses, once per file (a file in
 * several slots is fetched once). Revoke each `file.url` when done.
 */
export async function fetchMaterialTextures(live: LiveContext, material: MaterialRef | undefined, background = false): Promise<MaterialTexture[]> {
  const paths = [...new Set((material?.textures ?? []).flatMap((t) => (t.path ? [t.path] : [])))]
  const fetched = await Promise.all(
    paths.map(async (path) => {
      const [file, meta] = await Promise.all([
        fetchTextureFile(live, path, background),
        window.api.assets.readFile(live.repo, live.branch, `${path}.meta`, background).then((r) => (r.ok ? new TextDecoder().decode(r.data) : undefined))
      ])
      if (!file) return undefined
      const side = Math.max(file.width ?? 0, file.height ?? 0)
      const built = meta && file.width && file.height ? importedTextureSize(file.width, file.height, parseTextureMeta(meta)) : side
      return { path, file, built }
    })
  )
  return fetched.filter((t): t is MaterialTexture => !!t)
}

/** Slots for the preview shape's one material ('*'). */
export function materialSlots(material: MaterialRef | undefined, textures: readonly MaterialTexture[]): MaterialSlot[] {
  const byPath = new Map(textures.map((t) => [t.path, t.file]))
  return (material?.textures ?? []).flatMap((t) => {
    const file = t.path ? byPath.get(t.path) : undefined
    return file ? [{ material: '*', prop: t.prop ?? '', file }] : []
  })
}

/**
 * What a material weighs in a build: its textures (each file once). Textures
 * the preview cannot draw (EXR, TIFF) still count by file size.
 */
export function materialStats(material: MaterialRef | undefined, textures: readonly MaterialTexture[], matBytes: number, complete: boolean): StatsSummary {
  const found = new Map((material?.textures ?? []).flatMap((t) => (t.path ? [[t.path, t.size ?? 0] as const] : [])))
  for (const t of textures) found.set(t.path, t.file.bytes)
  return {
    triangles: 0,
    vertices: 0,
    bones: 0,
    clips: 0,
    materials: 1,
    fileBytes: matBytes,
    textureBytes: [...found.values()].reduce((s, b) => s + b, 0),
    maxTextureSize: Math.max(0, ...textures.map((t) => t.built)),
    textureCount: found.size,
    // Textures still being looked up may add to it: kept as a lesser measurement.
    source: complete ? 'viewer' : 'thumb'
  }
}
