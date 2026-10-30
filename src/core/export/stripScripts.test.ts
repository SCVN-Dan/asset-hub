import { describe, expect, it } from 'vitest'
import { stripScripts } from './stripScripts'

const MINE = 'a'.repeat(32)
const UI = 'b'.repeat(32)

const prefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_Component:
  - component: {fileID: 101}
  - component: {fileID: 102}
  - component: {fileID: 103}
  m_Name: Root
--- !u!4 &101
Transform:
  m_GameObject: {fileID: 100}
--- !u!114 &102
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: ${MINE}, type: 3}
  speed: 2
--- !u!114 &103
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: ${UI}, type: 3}
--- !u!1 &200
GameObject:
  m_Component:
  - component: {fileID: 201}
  m_Name: Child
--- !u!114 &201
MonoBehaviour:
  m_GameObject: {fileID: 200}
  m_Script: {fileID: 11500000, guid: ${MINE}, type: 3}
--- !u!1001 &300
PrefabInstance:
  m_Modification:
    m_AddedComponents:
    - targetCorrespondingSourceObject: {fileID: 5, guid: ${'c'.repeat(32)}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 301}
  m_SourcePrefab: {fileID: 100100000, guid: ${'c'.repeat(32)}, type: 3}
--- !u!114 &301
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: ${MINE}, type: 3}
`

describe('stripScripts', () => {
  const { text, removed } = stripScripts(prefab, new Set([MINE]))

  it('removes the components of the given scripts, on every object', () => {
    expect(removed).toBe(3)
    expect(text).not.toContain(MINE)
    expect(text).not.toMatch(/&10[2]|&201|&301/)
  })

  it('keeps other components and their references', () => {
    expect(text).toContain('--- !u!4 &101')
    expect(text).toContain(`guid: ${UI}`)
    expect(text).toContain('  - component: {fileID: 101}\n  - component: {fileID: 103}\n  m_Name: Root')
    expect(text).not.toMatch(/component: \{fileID: (102|201)\}/)
  })

  it('writes emptied lists as []', () => {
    expect(text).toContain('  m_Component: []\n  m_Name: Child')
    expect(text).toContain('    m_AddedComponents: []\n  m_SourcePrefab')
  })

  it('leaves a prefab without those scripts untouched', () => {
    expect(stripScripts(prefab, new Set(['d'.repeat(32)]))).toEqual({ text: prefab, removed: 0 })
  })
})
