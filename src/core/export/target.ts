// What a package would do to the Unity project it is imported into, judged
// from that project's files (read only): which files it already has, which it
// would overwrite or rename, and which it has under another GUID — those are
// left out and the package points at the project's copy instead.

/** What happens to one file of the package. */
export type TargetDecision =
  /** Not in the project: imported as usual. */
  | { action: 'add' }
  /** Same GUID, same content: nothing to import. */
  | { action: 'same'; existing: string }
  /** Same GUID, other content: Unity replaces the project's file (at its own path). */
  | { action: 'overwrite'; existing: string }
  /** Same content under another GUID: left out, references point at the project's copy. */
  | { action: 'reuse'; existing: string; guid: string }
  /** Its path is taken by another asset: Unity imports it as "Name 1". */
  | { action: 'rename'; existing: string }

export interface PackageCandidate {
  /** Repo path. */
  path: string
  guid: string
  /** Where it would land in the project ("Assets/…"). */
  pathname: string
  /** Content hash (same function as the project's). */
  hash: string
}

export interface TargetIndex {
  /** GUID → project path ("Assets/…"). */
  byGuid: ReadonlyMap<string, string>
  /** Content hash → project path and GUID, for the project files that could match. */
  byHash: ReadonlyMap<string, { path: string; guid: string }>
  /** Hash of a project file, by its path (for the files compared). */
  hashOf: ReadonlyMap<string, string>
  /** Lower-case project paths that exist. */
  paths: ReadonlySet<string>
}

export interface TargetPlan {
  decisions: Map<string, TargetDecision>
  /** Package GUID → project GUID, for files reused from the project. */
  remap: Map<string, string>
}

/**
 * Decides per file. `reuse` only applies when allowed: otherwise a same-content
 * file under another GUID is imported as a second copy (`add`, or `rename`).
 */
export function planAgainstTarget(files: readonly PackageCandidate[], target: TargetIndex, reuse: boolean): TargetPlan {
  const decisions = new Map<string, TargetDecision>()
  const remap = new Map<string, string>()
  for (const f of files) {
    const existing = target.byGuid.get(f.guid)
    if (existing) {
      decisions.set(f.path, target.hashOf.get(existing) === f.hash ? { action: 'same', existing } : { action: 'overwrite', existing })
      continue
    }
    const twin = target.byHash.get(f.hash)
    if (twin && reuse) {
      decisions.set(f.path, { action: 'reuse', existing: twin.path, guid: twin.guid })
      remap.set(f.guid, twin.guid)
      continue
    }
    decisions.set(f.path, target.paths.has(f.pathname.toLowerCase()) ? { action: 'rename', existing: f.pathname } : { action: 'add' })
  }
  return { decisions, remap }
}

const GUID_REF = /(guid: )([0-9a-f]{32})/g

/** Unity YAML (and .meta) text with references to remapped GUIDs pointed at the project's copies. */
export function remapGuids(text: string, remap: ReadonlyMap<string, string>): string {
  return remap.size ? text.replace(GUID_REF, (m, key: string, guid: string) => (remap.has(guid) ? key + remap.get(guid) : m)) : text
}

/** Files that hold Unity YAML (GUID references worth remapping): not binary models or images. */
export function isYamlAsset(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 64))
  return head.startsWith('%YAML')
}

/** Version of the Universal Render Pipeline a project uses, from Packages/packages-lock.json (or manifest.json). */
export function urpVersion(packagesJson: string | undefined): string | undefined {
  if (!packagesJson) return undefined
  try {
    const json = JSON.parse(packagesJson) as { dependencies?: Record<string, string | { version?: string }> }
    const dep = json.dependencies?.['com.unity.render-pipelines.universal']
    return typeof dep === 'string' ? dep : dep?.version
  } catch {
    return undefined
  }
}

/** Major.minor of two URP versions differ (a material or shader may not carry over as is). */
export function urpMismatch(source: string | undefined, target: string | undefined): boolean {
  if (!source) return false
  if (!target) return true
  const mm = (v: string) => v.split('.').slice(0, 2).join('.')
  return mm(source) !== mm(target)
}
