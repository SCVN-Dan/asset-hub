import { summarizeStats, type StatsSummary } from '@core/checks/playable'
import { extractFbxTextureNames } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import { FbxViewer, type TextureFile } from './FbxViewer'
import { fetchTextureFile, guessedSlots } from './textures'

/** Keeps background renders light: a few textures, the ones named inside the FBX. */
const MAX_TEXTURES = 6

let host: HTMLDivElement | undefined

/** Off-screen element that background viewers render into. */
export function offscreenHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '320px', height: '240px', pointerEvents: 'none' })
    document.body.appendChild(host)
  }
  return host
}

/**
 * Renders a grid thumbnail without opening the model: downloads the FBX and
 * the textures it names, draws one frame and returns a data URL. Materials
 * from .mat files (kind A) are added when the model is opened in the viewer,
 * which then replaces this thumbnail.
 */
export async function renderThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const bytes = unwrap(await window.api.assets.readFile(live.repo, live.branch, path, true))
  const names = extractFbxTextureNames(bytes)
  const found = names.length ? unwrap(await window.api.assets.findByNames(live.repo, live.branch, names, path, live.root)) : {}
  const paths = [...new Set(Object.values(found).filter((p): p is string => !!p))].slice(0, MAX_TEXTURES)
  const files = (await Promise.all(paths.map((p) => fetchTextureFile(live, p, true)))).filter((f): f is TextureFile => !!f)
  const viewer = new FbxViewer(offscreenHost())
  try {
    await viewer.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, new Map(files.map((f) => [f.name.toLowerCase(), f])))
    if (!viewer.hasColorMaps() && files.length) await viewer.applyMaterialSlots(guessedSlots(files))
    // Measured while the model is loaded anyway: lets results be ranked without opening them.
    return { url: viewer.snapshot(), stats: summarizeStats(viewer.stats(bytes.byteLength, files), 'thumb') }
  } finally {
    viewer.dispose()
    files.forEach((f) => URL.revokeObjectURL(f.url))
  }
}
