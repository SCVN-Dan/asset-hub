import { writeFile } from 'fs/promises'
import { gzipSync } from 'zlib'
import type { GitHubAssetSource } from '@core/github/source'
import { planPackage, unityPackageTar, type PackageFile } from '@core/export/unitypackage'
import type { ExportProgress, ExportRequest, ExportResult } from '@shared/ipc'

const DOWNLOAD_CONCURRENCY = 4

/** Resolves every requested asset, downloads files + .meta, and writes a gzipped .unitypackage. */
export async function exportUnityPackage(
  source: GitHubAssetSource,
  req: ExportRequest,
  target: string,
  onProgress: (p: ExportProgress) => void
): Promise<Omit<ExportResult, 'canceled'>> {
  const files = new Set<string>()
  const byName = new Set<string>()
  for (let i = 0; i < req.paths.length; i++) {
    onProgress({ stage: 'resolve', done: i, total: req.paths.length })
    const report = await source.resolve(req.repo, req.branch, req.paths[i], req.root)
    report.files.forEach((f) => files.add(f))
    for (const tex of report.embeddedTextures) if (tex.path && tex.matchedBy === 'name') byName.add(tex.path)
  }
  req.extraFiles.forEach((f) => files.add(f))
  const assets = [...files].filter((f) => !f.endsWith('.meta') && !(req.skipByName && byName.has(f)))

  const packed: PackageFile[] = []
  const missingMeta: string[] = []
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < assets.length) {
      const path = assets[next++]
      if (!files.has(`${path}.meta`)) missingMeta.push(path)
      else {
        const [asset, meta] = await Promise.all([source.readFile(req.repo, req.branch, path), source.readFile(req.repo, req.branch, `${path}.meta`)])
        packed.push({ path, asset, meta, preview: req.previews[path] })
      }
      onProgress({ stage: 'download', done: ++done, total: assets.length })
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))

  // Stable order: the requested models first, then the rest by path.
  const first = new Set(req.paths)
  packed.sort((a, b) => Number(first.has(b.path)) - Number(first.has(a.path)) || a.path.localeCompare(b.path))

  onProgress({ stage: 'write', done: 0, total: 1 })
  const plan = planPackage(packed, req.root, req.layout, req.repo)
  const bytes = gzipSync(unityPackageTar(plan))
  await writeFile(target, bytes)
  onProgress({ stage: 'write', done: 1, total: 1 })
  return {
    path: target,
    assets: plan.entries.length,
    bytes: bytes.byteLength,
    skipped: [...missingMeta.map((path) => ({ path, reason: 'noMeta' as const })), ...plan.skipped]
  }
}
