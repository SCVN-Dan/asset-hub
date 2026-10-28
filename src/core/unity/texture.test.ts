import { describe, expect, it } from 'vitest'
import { importedTextureSize, parseTextureMeta } from './yaml'
import { textureHandler } from '../handlers/texture'

const meta = `fileFormatVersion: 2
guid: 0123456789abcdef0123456789abcdef
TextureImporter:\r
  mipmaps:
    mipMapMode: 0
    enableMipMap: 1
    sRGBTexture: 1
  maxTextureSize: 2048
  textureType: 8
  alphaIsTransparency: 1
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    textureCompression: 1
    overridden: 0
  - serializedVersion: 3
    buildTarget: Android
    maxTextureSize: 512
    textureCompression: 1
    overridden: 1
  - serializedVersion: 3
    buildTarget: Standalone
    maxTextureSize: 4096
    overridden: 0
`

describe('texture import settings', () => {
  it('reads the importer and the platform overrides that are on', () => {
    const imp = parseTextureMeta(meta)
    expect(imp).toMatchObject({ textureType: 8, maxTextureSize: 2048, compression: 1, sRGB: true, mipmaps: true, alphaIsTransparency: true })
    expect(imp.overrides).toEqual([{ target: 'Android', maxTextureSize: 512, compression: 1 }])
  })

  it('caps the built size by the import max size, a mobile override first', () => {
    const imp = parseTextureMeta(meta)
    expect(importedTextureSize(4096, 2048, imp)).toBe(512)
    expect(importedTextureSize(4096, 2048, { ...imp, overrides: [] })).toBe(2048)
    expect(importedTextureSize(300, 200, imp)).toBe(300)
  })

  it('exports the texture with its .meta', async () => {
    const byPath = new Map([['A/t.png', { path: 'A/t.png', type: 'blob' as const, sha: 'x' }], ['A/t.png.meta', { path: 'A/t.png.meta', type: 'blob' as const, sha: 'y' }]])
    expect(textureHandler.match({ path: 'A/t.PSD', type: 'blob', sha: '' })).toBe(true)
    const r = await textureHandler.resolveDependencies!('A/t.png', { root: '', byPath, pathForGuid: () => undefined, pathsByName: () => [], readTexts: async () => new Map(), readBytes: async () => new Uint8Array() })
    expect(r.files).toEqual(['A/t.png', 'A/t.png.meta'])
  })
})
