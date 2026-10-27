import type { Asset } from './types'
import { dirName } from './registry'

export interface FolderNode {
  name: string
  /** Full folder path; '' for the root. */
  path: string
  children: FolderNode[]
  /** Assets in this folder and all sub-folders. */
  assetCount: number
}

/** Builds a folder tree that only contains folders holding at least one asset. */
export function buildFolderTree(assets: readonly Asset[]): FolderNode {
  const root: FolderNode = { name: '', path: '', children: [], assetCount: 0 }
  for (const asset of assets) {
    root.assetCount++
    const dir = dirName(asset.path)
    if (!dir) continue
    let node = root
    for (const segment of dir.split('/')) {
      const path = node.path ? `${node.path}/${segment}` : segment
      let child = node.children.find((c) => c.path === path)
      if (!child) {
        child = { name: segment, path, children: [], assetCount: 0 }
        node.children.push(child)
      }
      child.assetCount++
      node = child
    }
  }
  sortTree(root)
  return root
}

function sortTree(node: FolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name))
  node.children.forEach(sortTree)
}

/** True when `path` lies inside `folder` ('' matches everything). */
export function isInFolder(path: string, folder: string): boolean {
  return folder === '' || path.startsWith(folder + '/')
}
