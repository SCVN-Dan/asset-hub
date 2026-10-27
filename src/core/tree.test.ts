import { describe, expect, it } from 'vitest'
import { buildFolderTree, formatBytes, isInFolder } from './index'
import type { Asset } from './types'

const asset = (path: string): Asset => ({ id: path, type: 'fbx', path, name: path.split('/').pop()!, sha: 'x', lfs: false })

describe('buildFolderTree', () => {
  it('builds sorted folders with recursive asset counts', () => {
    const root = buildFolderTree([asset('Assets/B/x.fbx'), asset('Assets/A/y.fbx'), asset('Assets/A/Deep/z.fbx'), asset('top.fbx')])
    expect(root.assetCount).toBe(4)
    const assets = root.children[0]
    expect(assets).toMatchObject({ name: 'Assets', path: 'Assets', assetCount: 3 })
    expect(assets.children.map((c) => c.name)).toEqual(['A', 'B'])
    expect(assets.children[0]).toMatchObject({ path: 'Assets/A', assetCount: 2 })
    expect(assets.children[0].children[0]).toMatchObject({ path: 'Assets/A/Deep', assetCount: 1 })
  })
})

describe('isInFolder', () => {
  it('matches only real sub-paths', () => {
    expect(isInFolder('Assets/A/x.fbx', '')).toBe(true)
    expect(isInFolder('Assets/A/x.fbx', 'Assets/A')).toBe(true)
    expect(isInFolder('Assets/AB/x.fbx', 'Assets/A')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(4_812_330)).toBe('4.6 MB')
  })
})
