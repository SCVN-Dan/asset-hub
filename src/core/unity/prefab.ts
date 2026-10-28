// Which materials a prefab (or scene) puts on each model's meshes. Artists
// often assign materials on prefabs rather than on the FBX, so the FBX alone
// shows none.

const GUID = '[0-9a-f]{32}'

interface Doc {
  cls: string
  id: string
  body: string
}

function splitDocs(text: string): Doc[] {
  const docs: Doc[] = []
  const re = /^--- !u!(\d+) &(-?\d+)[^\n]*$/gm
  let m: RegExpExecArray | null
  let last: { cls: string; id: string; start: number } | undefined
  while ((m = re.exec(text))) {
    if (last) docs.push({ cls: last.cls, id: last.id, body: text.slice(last.start, m.index) })
    last = { cls: m[1], id: m[2], start: re.lastIndex }
  }
  if (last) docs.push({ cls: last.cls, id: last.id, body: text.slice(last.start) })
  return docs
}

/** Material GUIDs listed under `m_Materials:` in a renderer document. */
function rendererMaterials(body: string): string[] {
  const start = body.indexOf('m_Materials:')
  if (start === -1) return []
  const lines = body.slice(start).split('\n').slice(1)
  const out: string[] = []
  for (const line of lines) {
    if (!/^\s*- /.test(line)) break
    const g = new RegExp(`guid: (${GUID})`).exec(line)?.[1]
    if (g) out.push(g)
  }
  return out
}

const meshGuid = (body: string) => new RegExp(`m_Mesh: \\{fileID: -?\\d+, guid: (${GUID})`).exec(body)?.[1]
const gameObjectOf = (body: string) => /m_GameObject: \{fileID: (-?\d+)\}/.exec(body)?.[1]

/**
 * Model GUID → material GUIDs (in order of use, most used first) for every
 * mesh in a prefab/scene: SkinnedMeshRenderers, MeshFilter + MeshRenderer
 * pairs, and nested model instances whose materials are overridden.
 */
export function modelMaterials(text: string): Record<string, string[]> {
  const counts = new Map<string, Map<string, number>>()
  const add = (model: string, mats: readonly string[]) => {
    const m = counts.get(model) ?? new Map<string, number>()
    for (const g of mats) m.set(g, (m.get(g) ?? 0) + 1)
    counts.set(model, m)
  }
  const docs = splitDocs(text)
  const renderersByGo = new Map<string, string[]>()
  for (const d of docs) if (d.cls === '23') renderersByGo.set(gameObjectOf(d.body) ?? '', rendererMaterials(d.body))

  for (const d of docs) {
    if (d.cls === '137') {
      // SkinnedMeshRenderer: mesh and materials in the same component.
      const model = meshGuid(d.body)
      if (model) add(model, rendererMaterials(d.body))
    } else if (d.cls === '33') {
      // MeshFilter: materials live on the MeshRenderer of the same GameObject.
      const model = meshGuid(d.body)
      const mats = renderersByGo.get(gameObjectOf(d.body) ?? '')
      if (model && mats) add(model, mats)
    } else if (d.cls === '1001') {
      // A model dropped into the prefab as-is, with material overrides.
      const source = new RegExp(`m_SourcePrefab: \\{fileID: \\d+, guid: (${GUID})`).exec(d.body)?.[1]
      if (!source) continue
      const overrides: string[] = []
      const re = new RegExp(`propertyPath: m_Materials\\.Array\\.data\\[\\d+\\]\\s*\\n\\s*value:[^\\n]*\\n\\s*objectReference: \\{fileID: 2100000, guid: (${GUID})`, 'g')
      for (const m of d.body.matchAll(re)) overrides.push(m[1])
      if (overrides.length) add(source, overrides)
    }
  }
  const result: Record<string, string[]> = {}
  for (const [model, m] of counts) result[model] = [...m].sort((a, b) => b[1] - a[1]).map(([g]) => g)
  return result
}

const GENERIC_FOLDERS = new Set(
  ['assets', 'art', 'arts', 'model', 'models', 'mesh', 'meshes', 'fbx', 'fbxs', 'prefab', 'prefabs', 'material', 'materials', 'texture', 'textures', 'source', 'sources', 'sourcedependencies', 'resources', 'placeholder', 'placeholders', 'extracted', '_old', 'old', 'common', 'shared'].map((s) => s.toLowerCase())
)

/**
 * How related a prefab's folder is to a model's folder: the number of
 * distinctive folder names they share (Models/ASMR-Fish ↔ Prefabs/ASMR-Fish → 1).
 */
export function folderAffinity(modelPath: string, prefabPath: string, root: string): number {
  const names = (p: string) =>
    new Set(
      p
        .slice(root.length)
        .split('/')
        .slice(0, -1)
        .map((s) => s.toLowerCase())
        .filter((s) => !GENERIC_FOLDERS.has(s))
    )
  const a = names(modelPath)
  let score = 0
  for (const n of names(prefabPath)) if (a.has(n)) score++
  return score
}
