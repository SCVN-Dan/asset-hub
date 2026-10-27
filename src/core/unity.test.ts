import { describe, expect, it } from 'vitest'
import type { TreeEntry } from './types'
import { findUnityProjectRoots, isInExcludedFolder, projectEntries } from './unity'

const blob = (path: string): TreeEntry => ({ path, type: 'blob', sha: 'x' })

describe('Unity project roots', () => {
  it('finds nested and root-level projects, shortest first', () => {
    const entries = [
      blob('unity_project/game/ProjectSettings/ProjectVersion.txt'),
      blob('ProjectSettings/ProjectVersion.txt'),
      blob('tools/ProjectSettings/Other.txt')
    ]
    expect(findUnityProjectRoots(entries)).toEqual(['', 'unity_project/game/'])
  })

  it('re-bases Assets paths onto the project root', () => {
    const entries = [blob('unity_project/game/Assets/A/x.fbx'), blob('unity_project/game/Packages/manifest.json'), blob('docs/x.fbx')]
    expect(projectEntries(entries, 'unity_project/game/').map((e) => e.path)).toEqual(['Assets/A/x.fbx'])
  })
})

describe('isInExcludedFolder', () => {
  it('matches folder segments only, case-insensitively', () => {
    expect(isInExcludedFolder('Assets/_ThirdParty/FX/a.fbx', ['_thirdparty'])).toBe(true)
    expect(isInExcludedFolder('Assets/Art/_ThirdParty.fbx', ['_ThirdParty'])).toBe(false)
    expect(isInExcludedFolder('Assets/Art/a.fbx', [])).toBe(false)
  })
})
