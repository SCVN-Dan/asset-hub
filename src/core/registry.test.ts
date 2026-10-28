import { describe, expect, it } from 'vitest'
import { createDefaultRegistry, HandlerRegistry } from './index'
import { fbxHandler } from './handlers/fbx'
import { MockAssetSource } from './mock/mockSource'
import type { AssetTypeHandler, TreeEntry } from './types'

const blob = (path: string, extra: Partial<TreeEntry> = {}): TreeEntry => ({ path, type: 'blob', sha: 'x', ...extra })

describe('HandlerRegistry', () => {
  it('rejects duplicate handler ids', () => {
    const registry = new HandlerRegistry().register(fbxHandler)
    expect(() => registry.register(fbxHandler)).toThrow(/already registered/)
  })

  it('classifies FBX case-insensitively and ignores .meta, folders and other files', () => {
    const registry = createDefaultRegistry()
    expect(registry.classify(blob('A/Hero.fbx'))?.id).toBe('fbx')
    expect(registry.classify(blob('A/rock.FBX'))?.id).toBe('fbx')
    expect(registry.classify(blob('A/Hero.fbx.meta'))).toBeUndefined()
    expect(registry.classify({ path: 'A/Folder.fbx', type: 'tree', sha: 'x' })).toBeUndefined()
    expect(registry.classify(blob('A/Hero.mat'))).toBeUndefined()
  })

  it('uses the first matching handler in registration order', () => {
    const catchAll: AssetTypeHandler = { ...fbxHandler, id: 'any', match: () => true }
    const registry = new HandlerRegistry().register(fbxHandler).register(catchAll)
    expect(registry.classify(blob('Hero.fbx'))?.id).toBe('fbx')
    expect(registry.classify(blob('Hero.png'))?.id).toBe('any')
  })

  it('reports the real LFS size for LFS assets', () => {
    const [asset] = createDefaultRegistry().collectAssets([blob('A/Hero.fbx', { size: 132, lfs: true, lfsSize: 5000 })])
    expect(asset).toMatchObject({ id: 'A/Hero.fbx', type: 'fbx', name: 'Hero.fbx', size: 5000, lfs: true })
  })

  it('finds every FBX in the mock branches', async () => {
    const source = new MockAssetSource()
    const registry = createDefaultRegistry()
    const main = registry.collectAssets(await source.listTree('demo', 'main'))
    const develop = registry.collectAssets(await source.listTree('demo', 'develop'))
    const fbx = (list: typeof main) => list.filter((a) => a.type === 'fbx')
    expect(fbx(main)).toHaveLength(10)
    expect(fbx(develop)).toHaveLength(11)
    // Textures are assets of their own now.
    expect(main.filter((a) => a.type === 'texture').length).toBeGreaterThan(0)
    expect(main.every((a) => a.type === 'fbx' || a.type === 'texture')).toBe(true)
  })
})
