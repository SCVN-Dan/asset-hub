import { writeFile } from 'fs/promises'
import { promisify } from 'util'
import { gzip } from 'zlib'
import type { GitHubAssetSource } from '@core/github/source'
import { planPackage, unityPackageTar, type PackageFile, type PackagePlan } from '@core/export/unitypackage'
import { isYamlAsset, planAgainstTarget, remapGuids, shaderKind, shaderName, urpMismatch, urpVersion, type ProjectShader, type TargetIndex } from '@core/export/target'
import type { ExportProgress, ExportRequest, ExportResult, TargetReport } from '@shared/ipc'
import { parseShaderMapping, shaderMapper, SHADER_MAPPING_FILE } from '@core/export/shaderMapping'
import { contentHash, hasPackageCache, hashProjectFile, packageFiles, readProjectText, scanProject } from './targetProject'

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
  // Scripts from packages (GUID → the requested assets using them): the target project must have them.
  const packageScripts = new Map<string, Set<string>>()
  for (let i = 0; i < req.paths.length; i++) {
    onProgress({ stage: 'resolve', done: i, total: req.paths.length })
    const report = await source.resolve(req.repo, req.branch, req.paths[i], req.root)
    report.files.forEach((f) => files.add(f))
    for (const tex of report.embeddedTextures) if (tex.path && tex.matchedBy === 'name') byName.add(tex.path)
    for (const g of report.packageScripts ?? []) packageScripts.set(g, (packageScripts.get(g) ?? new Set()).add(req.paths[i]))
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
  if (req.targetProject) ({ plan, report: onTarget } = await againstTarget(source, req, plan, packageScripts))
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
async function againstTarget(
  source: GitHubAssetSource,
  req: ExportRequest,
  plan: PackagePlan,
  packageScripts: ReadonlyMap<string, ReadonlySet<string>>
): Promise<{ plan: PackagePlan; report: TargetReport }> {
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
    paths: new Set([...project.sizes.keys()].map((p) => p.toLowerCase())),
    shaders: new Map()
  }
  const candidates = plan.entries.map((e) => {
    const kind = shaderKind(e.file.path)
    const name = kind && shaderName(e.file.path, dec.decode(e.file.asset))
    return { path: e.file.path, guid: e.guid, pathname: e.pathname, hash: hashes.get(e.guid)!, ...(kind && name ? { shader: { name, kind } } : {}) }
  })
  const mappingText = await readProjectText(root, SHADER_MAPPING_FILE)
  const mapping = mappingText !== undefined ? parseShaderMapping(mappingText) : undefined
  // The project's shaders are only read when the package brings some, or materials may be switched to them.
  if (candidates.some((c) => c.shader) || mapping?.rules.length) {
    const own = new Map([...guidOf].filter(([p]) => shaderKind(p)))
    index.shaders = await projectShaders(root, [...own, ...(await packageFiles(root, /\.(shader|shadergraph)$/i))])
  }
  const mapper = mapping && shaderMapper(mapping.rules, index.shaders!, new Map(candidates.flatMap((c) => (c.shader ? [[c.guid, c.shader.name] as const] : []))))
  const { decisions, remap } = planAgainstTarget(candidates, index, req.reuseExisting !== false)
  const report: TargetReport = {
    project: root, same: 0, reused: [], overwrite: [], renamed: [], shaderByName: [], shaderKept: [], shaderClash: [], shaderMapped: [], missingScripts: [],
    mappingErrors: [...(mapping?.errors ?? []), ...(mapper?.errors ?? [])]
  }
  const entries: PackagePlan['entries'] = []
  for (const e of plan.entries) {
    const d = decisions.get(e.file.path)!
    if (d.action === 'same') report.same++
    else if (d.action === 'reuse') (d.byName ? report.shaderByName : report.reused).push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'keep') report.shaderKept.push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'clash') report.shaderClash.push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'overwrite') report.overwrite.push({ path: e.file.path, existing: d.existing })
    else if (d.action === 'rename') report.renamed.push({ path: e.file.path, existing: d.existing })
    if (d.action === 'same' || d.action === 'reuse' || d.action === 'keep') continue
    if (!isYamlAsset(e.file.asset)) {
      entries.push(remap.size ? { ...e, file: { ...e.file, meta: enc.encode(remapGuids(dec.decode(e.file.meta), remap)) } } : e)
      continue
    }
    let text = dec.decode(e.file.asset)
    const mapped = mapper?.map(text)
    if (mapped) {
      text = mapped.text
      report.shaderMapped.push({ path: e.file.path, existing: `${mapped.from} → ${mapped.to}` })
    }
    // References to files left out now point at the project's copies (materials, prefabs, .meta remaps).
    const file = remap.size || mapped ? { ...e.file, asset: enc.encode(remapGuids(text, remap)), meta: enc.encode(remapGuids(dec.decode(e.file.meta), remap)) } : e.file
    entries.push({ ...e, file })
  }
  report.missingScripts = await missingScripts(root, packageScripts, project.byGuid)
  const sourceUrp = urpVersion(await source.readFile(req.repo, req.branch, `${req.root}Packages/packages-lock.json`).then((b) => dec.decode(b), () => undefined))
  const targetUrp = urpVersion(await readProjectText(root, 'Packages/packages-lock.json'))
  if (sourceUrp && urpMismatch(sourceUrp, targetUrp)) report.urp = { source: sourceUrp, ...(targetUrp ? { target: targetUrp } : {}) }
  return { plan: { ...plan, entries }, report }
}

/** The project's shaders (.shader, Shader Graph) by name, from [path, GUID] pairs; a name given twice keeps the first file. */
async function projectShaders(root: string, files: ReadonlyArray<readonly [string, string]>): Promise<Map<string, ProjectShader>> {
  const shaders = new Map<string, ProjectShader>()
  const found = await Promise.all(
    files.map(async ([path, guid]) => {
      const kind = shaderKind(path)
      if (!kind) return undefined
      const text = await readProjectText(root, path)
      const name = text && shaderName(path, text)
      return name ? { name, shader: { path, guid, kind } } : undefined
    })
  )
  for (const f of found) if (f && !shaders.has(f.name)) shaders.set(f.name, f.shader)
  return shaders
}

/**
 * Package scripts the project has nowhere (Assets, its packages): Unity would
 * show "Missing Script" on the prefabs using them. Only judged once Unity has
 * resolved the project's packages, or every package script would look missing.
 */
async function missingScripts(root: string, scripts: ReadonlyMap<string, ReadonlySet<string>>, own: ReadonlyMap<string, string>): Promise<TargetReport['missingScripts']> {
  if (!scripts.size || !(await hasPackageCache(root))) return []
  const known = new Set((await packageFiles(root, /\.(cs|dll)$/i)).values())
  const missing = [...scripts].filter(([guid]) => !own.has(guid) && !known.has(guid))
  // One line per asset: the scripts it lacks.
  const byAsset = new Map<string, string[]>()
  for (const [guid, assets] of missing) for (const a of assets) byAsset.set(a, [...(byAsset.get(a) ?? []), guid.slice(0, 8)])
  return [...byAsset].map(([path, guids]) => ({ path, existing: guids.join(', ') }))
}
