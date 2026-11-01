import { describe, expect, it } from 'vitest'
import { allIn1Fragment } from './allIn1Vfx'

describe('AllIn1Vfx port', () => {
  it('writes out every TRANSFORM_TEX (WebGL has no token pasting), whatever the uv expression', () => {
    const glsl = allIn1Fragment(['SHAPE1DISTORT_ON', 'SHAPE2_ON', 'SHAPE2DISTORT_ON', 'DISTORT_ON', 'FADE_ON', 'MASK_ON', 'GLOWTEX_ON', 'GLOW_ON'])
    expect(glsl).not.toMatch(/TRANSFORM_TEX/)
    expect(glsl).toContain('((vTex0.xy) * _ShapeDistortTex_ST.xy + _ShapeDistortTex_ST.zw)')
  })

  it('declares only keywords it ports', () => {
    expect(allIn1Fragment(['GLOW_ON', 'DEPTHGLOW_ON', 'SOFTPART_ON'])).toMatch(/#define GLOW_ON 1/)
    expect(allIn1Fragment(['DEPTHGLOW_ON'])).not.toMatch(/#define DEPTHGLOW_ON/)
  })
})
