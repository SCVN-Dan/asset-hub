import type { TreeEntry } from './types'

const PROJECT_MARKER = 'ProjectSettings/ProjectVersion.txt'

/**
 * Unity project roots inside a repo, as path prefixes ('' or 'unity_project/game/').
 * Repos often nest the project in a sub-folder, so never assume the repo root.
 */
export function findUnityProjectRoots(entries: readonly TreeEntry[]): string[] {
  const roots: string[] = []
  for (const e of entries) {
    if (e.type !== 'blob') continue
    if (e.path === PROJECT_MARKER) roots.push('')
    else if (e.path.endsWith('/' + PROJECT_MARKER)) roots.push(e.path.slice(0, -PROJECT_MARKER.length))
  }
  return roots.sort((a, b) => a.length - b.length || a.localeCompare(b))
}

/** Entries under `<root>Assets/`, with paths made relative to the project root ('Assets/…'). */
export function projectEntries(entries: readonly TreeEntry[], root: string): TreeEntry[] {
  const prefix = root + 'Assets/'
  const result: TreeEntry[] = []
  for (const e of entries) {
    if (e.path.startsWith(prefix)) result.push({ ...e, path: e.path.slice(root.length) })
  }
  return result
}

/** True when any folder segment of `path` matches one of `folderNames` (case-insensitive). */
export function isInExcludedFolder(path: string, folderNames: readonly string[]): boolean {
  if (!folderNames.length) return false
  const wanted = new Set(folderNames.map((f) => f.toLowerCase()))
  const segments = path.split('/')
  return segments.slice(0, -1).some((s) => wanted.has(s.toLowerCase()))
}
