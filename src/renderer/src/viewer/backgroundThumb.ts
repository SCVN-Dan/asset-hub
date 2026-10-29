import { summarizeStats, type StatsSummary } from '@core/checks/playable'
import { extractFbxTextureNames, type DependencyReport } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import { FbxViewer, type MaterialSlot, type TextureFile } from './FbxViewer'
import { fetchTextureFile, guessedSlots, reportSlotPaths } from './textures'

/** Keeps background renders light: a few textures, the .mat ones first. Others still count by their size. */
const MAX_TEXTURES = 8

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
 * Renders a grid thumbnail without opening the model: downloads the FBX, the
 * textures of its .mat files (kind A, from GUIDs the branch already knows
 * nearby) and the textures it names, draws one frame and returns a data URL.
 * Every texture counts toward the size, even one not downloaded.
 */
export async function renderThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const [bytes, report] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path, true).then(unwrap),
    // Without its materials the model is still drawn and measured, as before.
    window.api.assets.resolve(live.repo, live.branch, path, live.root, 'quick').then(unwrap, () => undefined)
  ])
  const names = extractFbxTextureNames(bytes)
  const found = names.length ? unwrap(await window.api.assets.findByNames(live.repo, live.branch, names, path, live.root)) : {}
  const slotPaths = reportSlotPaths(report)
  const all = [...new Set([...slotPaths.map((s) => s.path), ...Object.values(found).filter((p): p is string => !!p)])]
  const fetched = await Promise.all(all.slice(0, MAX_TEXTURES).map(async (p) => [p, await fetchTextureFile(live, p, true)] as const))
  const byPath = new Map(fetched.filter((e): e is readonly [string, TextureFile] => !!e[1]))
  const files = [...byPath.values()]
  const viewer = new FbxViewer(offscreenHost())
  try {
    await viewer.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, new Map(files.map((f) => [f.name.toLowerCase(), f])))
    const slots = slotPaths.flatMap((s): MaterialSlot[] => {
      const file = byPath.get(s.path)
      return file ? [{ material: s.material, prop: s.prop, file }] : []
    })
    if (slots.length) await viewer.applyMaterialSlots(slots)
    else if (!viewer.hasColorMaps() && files.length) await viewer.applyMaterialSlots(guessedSlots(files))
    // Measured while the model is loaded anyway: lets results be ranked without opening them.
    const stats: StatsSummary = { ...summarizeStats(viewer.stats(bytes.byteLength, files), 'thumb'), matTextures: true }
    stats.textureBytes += skippedBytes(report, new Set(byPath.keys()))
    return { url: viewer.snapshot(), stats }
  } finally {
    viewer.dispose()
    files.forEach((f) => URL.revokeObjectURL(f.url))
  }
}

/** Size of the .mat textures left out of the render (over the limit, or not drawable like EXR). */
function skippedBytes(report: DependencyReport | undefined, drawn: ReadonlySet<string>): number {
  const sizes = new Map<string, number>()
  for (const m of report?.kind === 'A' ? report.materials : []) for (const t of m.textures) if (t.path && t.size && !drawn.has(t.path)) sizes.set(t.path, t.size)
  return [...sizes.values()].reduce((a, b) => a + b, 0)
}
