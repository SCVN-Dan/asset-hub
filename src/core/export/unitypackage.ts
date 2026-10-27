import { metaGuid } from '../unity/yaml'
import { tar, type TarFile } from './tar'

/** Where exported files land in the importing project. */
export type PackageLayout = 'source' | 'grouped'

export interface PackageFile {
  /** Repo path of the asset (not its .meta). */
  path: string
  asset: Uint8Array
  meta: Uint8Array
  /** PNG shown in Unity's import dialog. */
  preview?: Uint8Array
}

export interface PackagePlan {
  entries: Array<{ guid: string; pathname: string; file: PackageFile }>
  /** Files left out, with the reason. */
  skipped: Array<{ path: string; reason: 'noGuid' | 'duplicateGuid' }>
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * Path inside the importing project. `source` keeps the path the asset had in
 * the source project; `grouped` puts everything under Assets/AssetHub/<repo>/.
 */
export function packagePathname(repoPath: string, root: string, layout: PackageLayout, repoName: string): string {
  const inProject = repoPath.startsWith(root) ? repoPath.slice(root.length) : repoPath
  if (layout === 'source' || !inProject.startsWith('Assets/')) return inProject
  return `Assets/AssetHub/${repoName.replace(/[^A-Za-z0-9._-]/g, '_')}/${inProject.slice('Assets/'.length)}`
}

/** Pairs each file with the GUID from its .meta; one entry per GUID. */
export function planPackage(files: readonly PackageFile[], root: string, layout: PackageLayout, repoName: string): PackagePlan {
  const entries: PackagePlan['entries'] = []
  const skipped: PackagePlan['skipped'] = []
  const seen = new Set<string>()
  for (const file of files) {
    const guid = metaGuid(dec.decode(file.meta))
    if (!guid) skipped.push({ path: file.path, reason: 'noGuid' })
    else if (seen.has(guid)) skipped.push({ path: file.path, reason: 'duplicateGuid' })
    else {
      seen.add(guid)
      entries.push({ guid, pathname: packagePathname(file.path, root, layout, repoName), file })
    }
  }
  return { entries, skipped }
}

/**
 * The tar that Unity reads as a .unitypackage (gzip it before saving):
 *   <guid>/asset, <guid>/asset.meta, <guid>/pathname, optional <guid>/preview.png
 * Unity creates missing folders on import, so folder entries are not needed.
 */
export function unityPackageTar(plan: PackagePlan): Uint8Array {
  const files: TarFile[] = []
  for (const { guid, pathname, file } of plan.entries) {
    files.push({ name: `${guid}/asset`, data: file.asset })
    files.push({ name: `${guid}/asset.meta`, data: file.meta })
    files.push({ name: `${guid}/pathname`, data: enc.encode(pathname) })
    if (file.preview) files.push({ name: `${guid}/preview.png`, data: file.preview })
  }
  return tar(files)
}
