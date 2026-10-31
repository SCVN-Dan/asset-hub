import { metaGuid } from '../unity/yaml'
import { tar, type TarFile } from './tar'

/** Where exported files land in the importing project. */
export type PackageLayout = 'source' | 'grouped' | 'byType'

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

const BY_TYPE_ROOT = 'Assets/AssetHub'

/** Folder under Assets/AssetHub/ for each kind of file in the `byType` layout. */
const TYPE_FOLDERS: Array<[RegExp, string]> = [
  [/\.prefab$/i, 'Prefabs'],
  [/\.(fbx|obj|blend|dae|3ds|max|ma|mb)$/i, 'Models'],
  [/\.mat$/i, 'Materials'],
  // Kind B models find their textures by name in a Textures folder beside or above them.
  [/\.(png|jpe?g|tga|psd|tiff?|exr|hdr|bmp|gif|webp)$/i, 'Textures'],
  [/\.(anim|controller|overrideController|mask)$/i, 'Animations'],
  [/\.(wav|mp3|ogg|aiff?|flac|m4a)$/i, 'Audio'],
  [/\.(ttf|otf|ttc|fnt|fontsettings)$/i, 'Fonts'],
  // Custom shader importers' files too (.tcp2shader…), kept beside the includes they reach by relative path.
  [/\.(shader|hlsl|cginc|glslinc|compute|shadergraph|shadersubgraph|[a-z0-9]+shader)$/i, 'Shaders']
]

/**
 * Stays where it was in the source project in the `byType` layout: code
 * (moving it out of its Editor folder or .asmdef breaks compiling) and
 * folders Unity treats by name (Resources.Load works by path).
 */
const KEEP_IN_PLACE = /\.(cs|asmdef|asmref|dll|so|jslib|jspre)$|\/(Editor|Resources|Plugins|StreamingAssets|Editor Default Resources)\//i

/**
 * Path inside the importing project. `source` keeps the path the asset had in
 * the source project; `grouped` puts everything under Assets/AssetHub/<repo>/;
 * `byType` sorts files into Assets/AssetHub/Prefabs, Models, Textures… —
 * shaders keep their folders under Shaders/ so relative #includes still resolve.
 */
export function packagePathname(repoPath: string, root: string, layout: PackageLayout, repoName: string): string {
  const inProject = repoPath.startsWith(root) ? repoPath.slice(root.length) : repoPath
  if (layout === 'source' || !inProject.startsWith('Assets/')) return inProject
  const underAssets = inProject.slice('Assets/'.length)
  if (layout === 'grouped') return `Assets/AssetHub/${repoName.replace(/[^A-Za-z0-9._-]/g, '_')}/${underAssets}`
  if (KEEP_IN_PLACE.test(inProject)) return inProject
  const folder = TYPE_FOLDERS.find(([re]) => re.test(inProject))?.[1] ?? 'Other'
  return folder === 'Shaders' ? `${BY_TYPE_ROOT}/Shaders/${underAssets}` : `${BY_TYPE_ROOT}/${folder}/${baseName(underAssets)}`
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const parentName = (p: string) => baseName(p.slice(0, Math.max(0, p.lastIndexOf('/'))))

/**
 * Files of different GUIDs sent to the same path (two Body.png in Textures/)
 * would make Unity rename one to "Body 1.png". Each is moved into a subfolder
 * named after its source folder instead, keeping file names (kind B models
 * look textures up by name); the GUID tells apart folders of the same name.
 */
function separateClashes(entries: PackagePlan['entries']): void {
  const byPath = new Map<string, PackagePlan['entries']>()
  for (const e of entries) {
    const key = e.pathname.toLowerCase()
    byPath.set(key, [...(byPath.get(key) ?? []), e])
  }
  for (const group of byPath.values()) {
    if (group.length < 2) continue
    const folders = group.map((e) => parentName(e.file.path) || 'Root')
    group.forEach((e, i) => {
      const unique = folders.filter((f) => f.toLowerCase() === folders[i].toLowerCase()).length === 1
      const sub = unique ? folders[i] : `${folders[i]}_${e.guid.slice(0, 8)}`
      const at = e.pathname.lastIndexOf('/')
      e.pathname = `${e.pathname.slice(0, at)}/${sub}/${e.pathname.slice(at + 1)}`
    })
  }
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
  // Only this layout gathers files from many folders into one.
  if (layout === 'byType') separateClashes(entries)
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
