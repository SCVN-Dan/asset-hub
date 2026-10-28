import { describe, expect, it } from 'vitest'
import { parseSpriteMeta } from './yaml'

const sheet = `fileFormatVersion: 2
guid: 0123456789abcdef0123456789abcdef
TextureImporter:
  textureType: 8
  spriteMode: 2
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteSheet:
    serializedVersion: 2
    sprites:
    - serializedVersion: 2
      name: UI_Atlas_01_0
      rect:
        serializedVersion: 2
        x: 0
        y: 768
        width: 256
        height: 256
      alignment: 0
      pivot: {x: 0, y: 0}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline:
      - - {x: 1, y: 2}
        - {x: 3, y: 4}
      physicsShape: []
    - serializedVersion: 2
      name: UI_Button
      rect:
        serializedVersion: 2
        x: 256
        y: 768
        width: 128
        height: 64
      border: {x: 12, y: 10, z: 12, w: 10}
    outline: []
    physicsShape: []
  spritePackingTag: 
`

describe('parseSpriteMeta', () => {
  it('reads every sprite of a sheet, with rects and borders, skipping nested outlines', () => {
    expect(parseSpriteMeta(sheet)).toEqual({
      mode: 2,
      pixelsPerUnit: 100,
      border: undefined,
      packingTag: undefined,
      sprites: [
        { name: 'UI_Atlas_01_0', x: 0, y: 768, width: 256, height: 256, border: undefined },
        { name: 'UI_Button', x: 256, y: 768, width: 128, height: 64, border: { left: 12, bottom: 10, right: 12, top: 10 } }
      ]
    })
  })

  it('reads a single sprite with a 9-slice border (CRLF, empty sheet)', () => {
    const single = 'TextureImporter:\r\n  textureType: 8\r\n  spriteMode: 1\r\n  spritePixelsToUnits: 32\r\n  spriteBorder: {x: 27, y: 20, z: 27, w: 20}\r\n  spriteSheet:\r\n    serializedVersion: 2\r\n    sprites: []\r\n    outline: []\r\n  spritePackingTag: UI\r\n'
    expect(parseSpriteMeta(single)).toEqual({ mode: 1, pixelsPerUnit: 32, border: { left: 27, bottom: 20, right: 27, top: 20 }, sprites: [], packingTag: 'UI' })
  })

  it('is undefined for a texture that is not a sprite', () => {
    expect(parseSpriteMeta('TextureImporter:\n  textureType: 0\n  spriteMode: 1\n')).toBeUndefined()
  })
})
