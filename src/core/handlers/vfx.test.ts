import { describe, expect, it } from 'vitest'
import type { Asset } from '../types'
import { vfxHandler } from './vfx'

const asset = (path: string, sha: string, type = 'prefab') => ({ path, name: path.slice(path.lastIndexOf('/') + 1), type, sha }) as Asset
const stats = (emitters: number) => ({ triangles: 0, vertices: 0, bones: 0, clips: 0, materials: 0, fileBytes: 0, textureBytes: 0, maxTextureSize: 0, source: 'viewer', particles: emitters * 10, emitters }) as never

describe('VFX tab', () => {
  const facts = { effects: new Set(['fx1']) }

  it('lists only prefabs known to have particle systems, wherever they are', () => {
    expect(vfxHandler.alsoShows!(asset('Assets/Prefabs/Coin.prefab', 'fx1'), undefined, facts)).toBe(true)
    expect(vfxHandler.alsoShows!(asset('Assets/VFX/Holder.prefab', 'plain'), undefined, facts)).toBe(false)
    expect(vfxHandler.alsoShows!(asset('Assets/VFX/Hit.prefab', 'plain'), undefined, undefined)).toBe(false)
  })

  it('does not take a prefab in just because effects were measured inside it', () => {
    expect(vfxHandler.alsoShows!(asset('Assets/Prefabs/Additive GameObjects.prefab', 'x'), stats(2), facts)).toBe(false)
    expect(vfxHandler.alsoShows!(asset('Assets/VFX/Hit.mat', 'fx1', 'material'), undefined, facts)).toBe(false)
  })
})
