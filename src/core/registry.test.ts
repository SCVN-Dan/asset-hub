import { describe, expect, it } from 'vitest'
import { createDefaultRegistry, HandlerRegistry } from './index'
import { fbxHandler } from './handlers/fbx'
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
    expect(registry.classify(blob('A/Hero.mat'))?.id).toBe('material')
    expect(registry.classify(blob('A/Hero.prefab'))?.id).toBe('prefab')
    expect(registry.classify(blob('A/Hero.cs'))).toBeUndefined()
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

  it('sorts a branch into its asset types', () => {
    const registry = createDefaultRegistry()
    const assets = registry.collectAssets(
      ['Assets/Hero.fbx', 'Assets/Hero.fbx.meta', 'Assets/Rock.FBX', 'Assets/T/hero_d.png', 'Assets/M/Hero.mat', 'Assets/Fonts/Title SDF.asset', 'Assets/Scripts/Hero.cs'].map((p) => blob(p))
    )
    const of = (type: string) => assets.filter((a) => a.type === type).map((a) => a.name)
    expect(of('fbx')).toEqual(['Hero.fbx', 'Rock.FBX'])
    // Textures and materials are assets of their own.
    expect(of('texture')).toEqual(['hero_d.png'])
    expect(of('material')).toEqual(['Hero.mat'])
    // .meta files and scripts are not assets; .asset files are a hidden type (TextMeshPro fonts once a scan confirms them).
    expect(assets.some((a) => a.path.endsWith('.meta') || a.path.endsWith('.cs'))).toBe(false)
    expect(assets.every((a) => ['fbx', 'texture', 'material'].includes(a.type) || registry.get(a.type)?.hidden)).toBe(true)
  })
})
