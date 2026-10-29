import { writeFile } from 'fs/promises'
import { promisify } from 'util'
import { gzip } from 'zlib'
import type { GitHubAssetSource } from '@core/github/source'
import { planPackage, unityPackageTar, type PackageFile, type PackagePlan } from '@core/export/unitypackage'
import { isYamlAsset, planAgainstTarget, remapGuids, urpMismatch, urpVersion, type TargetIndex } from '@core/export/target'
import type { ExportProgress, ExportRequest, ExportResult, TargetReport } from '@shared/ipc'
import { contentHash, hashProjectFile, readProjectText, scanProject } from './targetProject'

const DOWNLOAD_CONCURRENCY = 4
const gzipAsync = promisify(gzip)

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
  let plan = planPackage(packed, req.root, req.layout, req.repo)
  let onTarget: TargetReport | undefined
  if (req.targetProject) ({ plan, report: onTarget } = await againstTarget(source, req, plan))
  // Off the main thread: a big package would otherwise freeze the window while compressing.
  const bytes = await gzipAsync(unityPackageTar(plan))
  await writeFile(target, bytes)
  onProgress({ stage: 'write', done: 1, total: 1 })
  return {
    path: target,
    assets: plan.entries.length,
    bytes: bytes.byteLength,
    skipped: [...missingMeta.map((path) => ({ path, reason: 'noMeta' as const })), ...plan.skipped],
    ...(onTarget ? { target: onTarget } : {})
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * Compares the package with the target project (read from disk, never
 * written): leaves out what it already has, points references at its copies
 * of identical files, and reports what Unity would overwrite or rename.
 */
async function againstTarget(source: GitHubAssetSource, req: ExportRequest, plan: PackagePlan): Promise<{ plan: PackagePlan; report: TargetReport }> {
  const root = req.targetProject!
  const project = await scanProject(root)
  const hashes = new Map(plan.entries.map((e) => [e.guid, contentHash(e.file.asset)]))
  // Project files worth hashing: the ones with a package file's GUID, and the ones of the same size as one.
  const compare = new Set<string>()
  for (const e of plan.entries) {
    const byGuid = project.byGuid.get(e.guid)
    if (byGuid) compare.add(byGuid)
    for (const p of project.bySize.get(e.file.asset.byteLength) ?? []) compare.add(p)
  }
  const hashOf = new Map<string, string>()
  await Promise.all([...compare].map(async (p) => {
    const h = await hashProjectFile(root, p)
    if (h) hashOf.set(p, h)
  }))
  const guidOf = new Map([...project.byGuid].map(([g, p]) => [p, g]))
  const index: TargetIndex = {
    byGuid: project.byGuid,
    // Only files with a GUID can be pointed at.
    byHash: new Map([...hashOf].flatMap(([p, h]) => (guidOf.has(p) ? [[h, { path: p, guid: guidOf.get(p)! }] as const] : []))),
    hashOf,
    paths: new Set([...project.sizes.keys()].map((p) => p.toLowerCase()))
  }
  const { decisions, remap } = planAgainstTarget(
    plan.entries.map((e) => ({ path: e.file.path, guid: e.guid, pathname: e.pathname, hash: hashes.get(e.guid)! })),
    index,
    req.reuseExisting !== false
  )
  const report: TargetReport = { project: root, same: 0, reused: [], overwrite: [], renamed: [] }
  const entries: PackagePlan['entries'] = []
  for (const e of plan.entries) {
    const d = decisions.get(e.file.path)!
    if (d.action === 'same') report.same++
    else if (d.action === 'reuse') report.reused.push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'overwrite') report.overwrite.push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'rename') report.renamed.push({ path: e.file.path, existing: d.existing })
    if (d.action === 'same' || d.action === 'reuse') continue
    // References to files left out now point at the project's copies (materials, prefabs, .meta remaps).
    const file = remap.size
      ? { ...e.file, asset: isYamlAsset(e.file.asset) ? enc.encode(remapGuids(dec.decode(e.file.asset), remap)) : e.file.asset, meta: enc.encode(remapGuids(dec.decode(e.file.meta), remap)) }
      : e.file
    entries.push({ ...e, file })
  }
  const sourceUrp = urpVersion(await source.readFile(req.repo, req.branch, `${req.root}Packages/packages-lock.json`).then((b) => dec.decode(b), () => undefined))
  const targetUrp = urpVersion(await readProjectText(root, 'Packages/packages-lock.json'))
  if (sourceUrp && urpMismatch(sourceUrp, targetUrp)) report.urp = { source: sourceUrp, ...(targetUrp ? { target: targetUrp } : {}) }
  return { plan: { ...plan, entries }, report }
}
