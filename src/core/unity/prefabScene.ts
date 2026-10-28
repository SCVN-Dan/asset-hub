// What a prefab is made of, read from its YAML: the transform tree, which
// meshes sit where with which materials, nested prefab / model instances, and
// the components a preview cannot show (scripts, particle systems, UI).

const GUID = '[0-9a-f]{32}'

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

/** A Transform (or RectTransform) and its GameObject. Ids are the Transform's fileID. */
export interface SceneNode {
  id: string
  name: string
  /** Parent Transform id; absent for the root. */
  parent?: string
  position: Vec3
  rotation: Quat
  scale: Vec3
  active: boolean
  /** Placeholder for a Transform inside a nested instance ("stripped"): stands for that instance. */
  instance?: string
}

/** A MeshFilter + MeshRenderer pair, or a SkinnedMeshRenderer. */
export interface SceneMesh {
  node: string
  mesh: { fileID: string; guid: string }
  /** Material GUIDs by submesh. */
  materials: string[]
  skinned: boolean
}

/** A nested prefab or a model dropped in as it is. */
export interface SceneInstance {
  id: string
  source: string
  /** Transform it hangs under in this prefab. */
  parent?: string
  /** Overrides on the instance's root transform. */
  position?: Vec3
  rotation?: Quat
  scale?: Vec3
  /** Material overrides (applied to every renderer of the instance). */
  materials: string[]
  /** GameObject name override of the root. */
  name?: string
}

export interface PrefabScene {
  nodes: Map<string, SceneNode>
  meshes: SceneMesh[]
  instances: SceneInstance[]
  /** MonoBehaviour script GUIDs (custom or from packages). */
  scripts: string[]
  particleSystems: number
  /** RectTransforms: a UI prefab. */
  uiElements: number
  /** Every GUID the prefab references, whatever it is. */
  guids: string[]
}

interface Doc {
  cls: string
  id: string
  stripped: boolean
  body: string
}

function splitDocs(text: string): Doc[] {
  const docs: Doc[] = []
  const re = /^--- !u!(\d+) &(-?\d+)([^\n]*)$/gm
  let m: RegExpExecArray | null
  let last: { cls: string; id: string; stripped: boolean; start: number } | undefined
  while ((m = re.exec(text))) {
    if (last) docs.push({ cls: last.cls, id: last.id, stripped: last.stripped, body: text.slice(last.start, m.index) })
    last = { cls: m[1], id: m[2], stripped: /stripped/.test(m[3]), start: re.lastIndex }
  }
  if (last) docs.push({ cls: last.cls, id: last.id, stripped: last.stripped, body: text.slice(last.start) })
  return docs
}

const ref = (body: string, key: string) => new RegExp(`${key}: \\{fileID: (-?\\d+)`).exec(body)?.[1]
const refGuid = (body: string, key: string) => {
  const m = new RegExp(`${key}: \\{fileID: (-?\\d+), guid: (${GUID})`).exec(body)
  return m ? { fileID: m[1], guid: m[2] } : undefined
}
const nums = (body: string, key: string, keys: readonly string[]): number[] | undefined => {
  const line = new RegExp(`${key}: \\{([^}]*)\\}`).exec(body)?.[1]
  if (!line) return undefined
  const values = keys.map((k) => Number(new RegExp(`\\b${k}: (-?[\\d.eE+-]+)`).exec(line)?.[1]))
  return values.every(Number.isFinite) ? values : undefined
}

function materialList(body: string): string[] {
  const start = body.indexOf('m_Materials:')
  if (start === -1) return []
  const out: string[] = []
  for (const line of body.slice(start).split('\n').slice(1)) {
    if (!/^\s*- /.test(line)) break
    out.push(new RegExp(`guid: (${GUID})`).exec(line)?.[1] ?? '')
  }
  return out
}

/** Root transform overrides of an instance: the target that carries m_LocalPosition / m_LocalRotation. */
function instanceOverrides(body: string): Pick<SceneInstance, 'position' | 'rotation' | 'scale' | 'materials' | 'name'> {
  const mods = [...body.matchAll(new RegExp(`- target: \\{fileID: (-?\\d+)[^}]*\\}\\s*\\n\\s*propertyPath: ([^\\n]+)\\n\\s*value: ([^\\n]*)\\n\\s*objectReference: \\{fileID: (-?\\d+)(?:, guid: (${GUID}))?`, 'g'))].map(
    (m) => ({ target: m[1], path: m[2].trim(), value: m[3].trim(), refGuid: m[5] })
  )
  const transformTargets = mods.filter((m) => /^m_Local(Position|Rotation)\./.test(m.path)).map((m) => m.target)
  // Unity writes position and rotation overrides for an instance's root; the first such target is it.
  const root = transformTargets[0]
  const read = (prop: string, keys: readonly string[]) => {
    const values = keys.map((k) => mods.find((m) => m.target === root && m.path === `${prop}.${k}`)?.value)
    return values.every((v) => v !== undefined && Number.isFinite(Number(v))) ? values.map(Number) : undefined
  }
  const materials: string[] = []
  for (const m of mods) {
    const i = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(m.path)?.[1]
    if (i !== undefined && m.refGuid) materials[Number(i)] = m.refGuid
  }
  return {
    position: read('m_LocalPosition', ['x', 'y', 'z']) as Vec3 | undefined,
    rotation: read('m_LocalRotation', ['x', 'y', 'z', 'w']) as Quat | undefined,
    scale: read('m_LocalScale', ['x', 'y', 'z']) as Vec3 | undefined,
    materials: Array.from(materials, (g) => g ?? ''),
    name: mods.find((m) => m.path === 'm_Name')?.value || undefined
  }
}

export function parsePrefabScene(prefabText: string): PrefabScene {
  const text = prefabText.replace(/\r\n/g, '\n')
  const docs = splitDocs(text)
  const gameObjects = new Map(docs.filter((d) => d.cls === '1' && !d.stripped).map((d) => [d.id, d]))
  /** GameObject id → its Transform id. */
  const transformOf = new Map<string, string>()
  const nodes = new Map<string, SceneNode>()
  for (const d of docs) {
    if (d.cls !== '4' && d.cls !== '224') continue
    if (d.stripped) {
      // A transform of a nested instance that something here hangs under.
      nodes.set(d.id, { id: d.id, name: '', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], active: true, instance: ref(d.body, 'm_PrefabInstance') })
      continue
    }
    const go = ref(d.body, 'm_GameObject') ?? ''
    transformOf.set(go, d.id)
    const goBody = gameObjects.get(go)?.body ?? ''
    const father = ref(d.body, 'm_Father')
    nodes.set(d.id, {
      id: d.id,
      name: /^\s*m_Name: (.*)$/m.exec(goBody)?.[1]?.trim() ?? '',
      parent: father && father !== '0' ? father : undefined,
      position: (nums(d.body, 'm_LocalPosition', ['x', 'y', 'z']) ?? [0, 0, 0]) as Vec3,
      rotation: (nums(d.body, 'm_LocalRotation', ['x', 'y', 'z', 'w']) ?? [0, 0, 0, 1]) as Quat,
      scale: (nums(d.body, 'm_LocalScale', ['x', 'y', 'z']) ?? [1, 1, 1]) as Vec3,
      active: !/^\s*m_IsActive: 0/m.test(goBody)
    })
  }

  const renderers = new Map<string, string[]>()
  for (const d of docs) if (d.cls === '23' && !d.stripped) renderers.set(ref(d.body, 'm_GameObject') ?? '', materialList(d.body))
  const meshes: SceneMesh[] = []
  for (const d of docs) {
    if (d.stripped || (d.cls !== '33' && d.cls !== '137')) continue
    const mesh = refGuid(d.body, 'm_Mesh')
    const go = ref(d.body, 'm_GameObject') ?? ''
    const node = transformOf.get(go)
    if (!mesh || !node) continue
    const skinned = d.cls === '137'
    meshes.push({ node, mesh, materials: skinned ? materialList(d.body) : (renderers.get(go) ?? []), skinned })
  }

  const instances: SceneInstance[] = []
  for (const d of docs) {
    if (d.cls !== '1001') continue
    const source = refGuid(d.body, 'm_SourcePrefab')?.guid
    if (!source) continue
    const parent = ref(d.body, 'm_TransformParent')
    instances.push({ id: d.id, source, parent: parent && parent !== '0' ? parent : undefined, ...instanceOverrides(d.body) })
  }

  const scripts = [
    ...new Set(docs.filter((d) => d.cls === '114' && !d.stripped).flatMap((d) => (refGuid(d.body, 'm_Script')?.guid ? [refGuid(d.body, 'm_Script')!.guid] : [])))
  ]
  const guids = [...new Set([...text.matchAll(new RegExp(`guid: (${GUID})`, 'g'))].map((m) => m[1]))]
  return {
    nodes,
    meshes,
    instances,
    scripts,
    particleSystems: docs.filter((d) => d.cls === '198' && !d.stripped).length,
    uiElements: docs.filter((d) => d.cls === '224' && !d.stripped).length,
    guids
  }
}

/**
 * Mesh names an FBX's .meta gives its mesh fileIDs, when it lists them
 * (internalIDToNameTable, or fileIDToRecycleName before Unity 2019.3).
 * Newer imports derive fileIDs from names and list nothing: empty map.
 */
export function fbxMeshNames(metaText: string): Map<string, string> {
  const text = metaText.replace(/\r\n/g, '\n')
  const names = new Map<string, string>()
  for (const m of text.matchAll(/- first:\n\s*43: (-?\d+)\n\s*second: ([^\n]*)/g)) names.set(m[1], m[2].trim())
  const recycle = /^ {2}fileIDToRecycleName:\n((?: {4}.*\n?)*)/m.exec(text)?.[1] ?? ''
  for (const m of recycle.matchAll(/^ {4}(43\d{5}): (.*)$/gm)) names.set(m[1], m[2].trim())
  return names
}

/** Unity's import scale settings of a model (globalScale, useFileScale). */
export function modelImportScale(metaText: string): { globalScale: number; useFileScale: boolean } {
  const g = Number(/^\s*globalScale: ([\d.eE+-]+)/m.exec(metaText)?.[1])
  return { globalScale: Number.isFinite(g) && g > 0 ? g : 1, useFileScale: !/^\s*useFileScale: 0/m.test(metaText) }
}
