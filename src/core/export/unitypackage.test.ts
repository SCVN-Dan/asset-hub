import { describe, expect, it } from 'vitest'
import { tar } from './tar'
import { packagePathname, planPackage, unityPackageTar, type PackageFile } from './unitypackage'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Minimal ustar reader to check what the writer produced. */
function untar(bytes: Uint8Array): Array<{ name: string; data: string; checksumOk: boolean }> {
  const out: Array<{ name: string; data: string; checksumOk: boolean }> = []
  for (let pos = 0; pos + 512 <= bytes.length; ) {
    const h = bytes.subarray(pos, pos + 512)
    if (h.every((b) => b === 0)) break
    const name = dec.decode(h.subarray(0, 100)).replace(/\0.*$/s, '')
    const size = parseInt(dec.decode(h.subarray(124, 136)).replace(/\0.*$/s, ''), 8)
    const stored = parseInt(dec.decode(h.subarray(148, 156)).replace(/[\0 ].*$/s, ''), 8)
    let sum = 0
    h.forEach((b, i) => (sum += i >= 148 && i < 156 ? 0x20 : b))
    out.push({ name, data: dec.decode(bytes.subarray(pos + 512, pos + 512 + size)), checksumOk: sum === stored })
    pos += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

const G = (n: number) => n.toString(16).padStart(32, '0')
const file = (path: string, guid: string | null, extra: Partial<PackageFile> = {}): PackageFile => ({
  path,
  asset: enc.encode(`bytes of ${path}`),
  meta: enc.encode(guid ? `fileFormatVersion: 2\nguid: ${guid}\n` : 'fileFormatVersion: 2\n'),
  ...extra
})

describe('tar', () => {
  it('writes valid ustar headers, padding and the end marker', () => {
    const bytes = tar([
      { name: 'a/asset', data: enc.encode('x'.repeat(600)) },
      { name: 'a/pathname', data: enc.encode('Assets/A.fbx') }
    ])
    expect(bytes.length).toBe(512 + 1024 + 512 + 512 + 1024)
    const entries = untar(bytes)
    expect(entries.map((e) => [e.name, e.data.length, e.checksumOk])).toEqual([
      ['a/asset', 600, true],
      ['a/pathname', 12, true]
    ])
    expect(dec.decode(bytes.subarray(257, 262))).toBe('ustar')
  })
})

describe('unitypackage', () => {
  it('maps repo paths to project paths for both layouts', () => {
    expect(packagePathname('proj/Assets/Art/Hero.fbx', 'proj/', 'source', 'org/game')).toBe('Assets/Art/Hero.fbx')
    expect(packagePathname('proj/Assets/Art/Hero.fbx', 'proj/', 'grouped', 'org/game')).toBe('Assets/AssetHub/org_game/Art/Hero.fbx')
  })

  it('sorts files by type under Assets/AssetHub/', () => {
    const path = (p: string) => packagePathname(`proj/${p}`, 'proj/', 'byType', 'org/game')
    expect(path('Assets/Art/Hero/Hero.prefab')).toBe('Assets/AssetHub/Prefabs/Hero.prefab')
    expect(path('Assets/Art/Hero/Hero.FBX')).toBe('Assets/AssetHub/Models/Hero.FBX')
    expect(path('Assets/Art/Hero/Mat/Hero.mat')).toBe('Assets/AssetHub/Materials/Hero.mat')
    expect(path('Assets/Art/Hero/Tex/Hero_D.psd')).toBe('Assets/AssetHub/Textures/Hero_D.psd')
    expect(path('Assets/Art/Hero/Anim/Run.anim')).toBe('Assets/AssetHub/Animations/Run.anim')
    expect(path('Assets/Sfx/Hit.wav')).toBe('Assets/AssetHub/Audio/Hit.wav')
    expect(path('Assets/UI/Fonts/Jua.ttf')).toBe('Assets/AssetHub/Fonts/Jua.ttf')
    expect(path('Assets/Art/Atlas.spriteatlas')).toBe('Assets/AssetHub/Other/Atlas.spriteatlas')
    // Shaders keep their folders so relative #includes still resolve.
    expect(path('Assets/Shaders/Toon/Toon.shader')).toBe('Assets/AssetHub/Shaders/Shaders/Toon/Toon.shader')
    expect(path('Assets/Shaders/Common.hlsl')).toBe('Assets/AssetHub/Shaders/Shaders/Common.hlsl')
    // Code and folders Unity treats by name stay where they were.
    expect(path('Assets/Scripts/Spin.cs')).toBe('Assets/Scripts/Spin.cs')
    expect(path('Assets/Art/Resources/Icon.png')).toBe('Assets/Art/Resources/Icon.png')
    expect(path('Packages/com.x/Tex.png')).toBe('Packages/com.x/Tex.png')
  })

  it('puts files that would share a path into folders named after their source folder', () => {
    const H = (c: string) => c.repeat(32)
    const plan = planPackage(
      [file('p/Assets/Goblin/Body.png', H('a')), file('p/Assets/Orc/body.png', H('b')), file('p/Assets/A/Orc/Body.png', H('c')), file('p/Assets/Orc/Orc.fbx', H('d'))],
      'p/',
      'byType',
      'o/r'
    )
    expect(plan.entries.map((e) => e.pathname)).toEqual([
      'Assets/AssetHub/Textures/Goblin/Body.png',
      'Assets/AssetHub/Textures/Orc_bbbbbbbb/body.png',
      'Assets/AssetHub/Textures/Orc_cccccccc/Body.png',
      'Assets/AssetHub/Models/Orc.fbx'
    ])
  })

  it('keeps one entry per GUID and reports files without a GUID', () => {
    const plan = planPackage([file('p/Assets/A.fbx', G(1)), file('p/Assets/T.png', G(2)), file('p/Assets/T2.png', G(2)), file('p/Assets/N.mat', null)], 'p/', 'source', 'o/r')
    expect(plan.entries.map((e) => [e.guid, e.pathname])).toEqual([
      [G(1), 'Assets/A.fbx'],
      [G(2), 'Assets/T.png']
    ])
    expect(plan.skipped).toEqual([
      { path: 'p/Assets/T2.png', reason: 'duplicateGuid' },
      { path: 'p/Assets/N.mat', reason: 'noGuid' }
    ])
  })

  it('lays out <guid>/asset, asset.meta, pathname and preview.png', () => {
    const plan = planPackage([file('p/Assets/A.fbx', G(1), { preview: enc.encode('PNG') }), file('p/Assets/T.png', G(2))], 'p/', 'source', 'o/r')
    const entries = untar(unityPackageTar(plan))
    expect(entries.map((e) => e.name)).toEqual([
      `${G(1)}/asset`,
      `${G(1)}/asset.meta`,
      `${G(1)}/pathname`,
      `${G(1)}/preview.png`,
      `${G(2)}/asset`,
      `${G(2)}/asset.meta`,
      `${G(2)}/pathname`
    ])
    expect(entries.find((e) => e.name === `${G(1)}/pathname`)?.data).toBe('Assets/A.fbx')
    expect(entries.find((e) => e.name === `${G(2)}/asset`)?.data).toBe('bytes of p/Assets/T.png')
    expect(entries.every((e) => e.checksumOk)).toBe(true)
  })
})
