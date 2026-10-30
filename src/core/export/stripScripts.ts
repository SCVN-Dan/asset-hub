/**
 * Removes the components of the given scripts (MonoBehaviours by script GUID)
 * from a prefab's YAML: their documents, the GameObjects' `- component:` lines
 * pointing at them, and `m_AddedComponents` entries adding them to nested
 * prefabs. Everything else (Transforms, renderers, particle systems…) stays.
 */
export function stripScripts(text: string, scripts: ReadonlySet<string>): { text: string; removed: number } {
  // Unity YAML: "--- !u!<class> &<fileID>" starts each object.
  const docs = text.split(/(?=^--- !u!)/m)
  const removed = new Set<string>()
  const kept = docs.filter((doc) => {
    const head = /^--- !u!114 &(-?\d+)(?! stripped)/.exec(doc)
    const script = head && /^ {2}m_Script: \{fileID: -?\d+, guid: ([0-9a-f]{32})/m.exec(doc)?.[1]
    if (!head || !script || !scripts.has(script)) return true
    removed.add(head[1])
    return false
  })
  if (!removed.size) return { text, removed: 0 }
  const gone = (id: string) => removed.has(id)
  const out = kept
    .join('')
    .replace(/^ *- component: \{fileID: (-?\d+)\}\n/gm, (line, id: string) => (gone(id) ? '' : line))
    .replace(/^( *)- targetCorrespondingSourceObject: .*\n\1 {2}insertIndex: .*\n\1 {2}addedObject: \{fileID: (-?\d+)\}\n/gm, (entry, _i, id: string) => (gone(id) ? '' : entry))
    // A list left without entries is written as [] by Unity.
    .replace(/^( *)(m_Component|m_AddedComponents):\n(?!\1[ -])/gm, '$1$2: []\n')
  return { text: out, removed: removed.size }
}
