import { describe, expect, it } from 'vitest'
import { builtAudioBytes, effectiveAudioImport, parseAudioMeta } from './yaml'
import { summaryIssues } from '../checks/playable'
import { audioHandler } from '../handlers/audio'

const meta = `fileFormatVersion: 2
guid: f88e41c34b5a345e4bd9b91343cf1377
AudioImporter:\r
  externalObjects: {}
  serializedVersion: 7
  defaultSettings:
    serializedVersion: 2
    loadType: 0
    sampleRateSetting: 0
    sampleRateOverride: 44100
    compressionFormat: 1
    quality: 0.7
    conversionMode: 0
  platformSettingOverrides:
    1:
      loadType: 2
      compressionFormat: 0
      quality: 1
    13:
      loadType: 1
      sampleRateSetting: 2
      sampleRateOverride: 22050
      compressionFormat: 2
      quality: 1
  forceToMono: 1
  normalize: 1
  preloadAudioData: 1
  loadInBackground: 0
  3D: 1
`

describe('audio import settings', () => {
  it('reads defaults, flags and per-platform overrides', () => {
    const imp = parseAudioMeta(meta)
    expect(imp).toMatchObject({ loadType: 0, compressionFormat: 1, quality: 0.7, sampleRateSetting: 0, forceToMono: true, preload: true, loadInBackground: false })
    expect(imp.overrides).toEqual([
      { target: 'Standalone', loadType: 2, compressionFormat: 0, quality: 1, sampleRateSetting: undefined, sampleRateOverride: undefined },
      { target: 'WebGL', loadType: 1, compressionFormat: 2, quality: 1, sampleRateSetting: 2, sampleRateOverride: 22050 }
    ])
  })

  it('uses the WebGL override for builds, else the defaults', () => {
    expect(effectiveAudioImport(parseAudioMeta(meta)).compressionFormat).toBe(2)
    expect(effectiveAudioImport(parseAudioMeta(meta.replace('    13:', '    99:'))).compressionFormat).toBe(1)
  })

  it('handles a .meta without overrides', () => {
    expect(parseAudioMeta('AudioImporter:\n  defaultSettings:\n    loadType: 2\n  platformSettingOverrides: {}\n  forceToMono: 0\n')).toMatchObject({ loadType: 2, forceToMono: false, overrides: [] })
  })

  it('estimates built size: PCM exactly, ADPCM a quarter of it, mono and resampling applied', () => {
    expect(builtAudioBytes(10, 44100, 2, parseAudioMeta(meta.replace('compressionFormat: 2', 'compressionFormat: 0').replace('forceToMono: 1', 'forceToMono: 0')))).toBe(10 * 22050 * 2 * 2)
    expect(builtAudioBytes(10, 44100, 2, parseAudioMeta(meta))).toBe((10 * 22050 * 1) / 2)
    // No .meta: Unity's default (Vorbis 100%).
    expect(builtAudioBytes(10, 44100, 2, undefined)).toBe(320_000)
  })

  it('judges clips by their own budget, not the model file budget', () => {
    const base = { triangles: 0, vertices: 0, bones: 0, clips: 0, materials: 0, textureBytes: 0, maxTextureSize: 0, source: 'viewer' as const }
    expect(summaryIssues({ ...base, fileBytes: 2_000_000, duration: 90 }).map((i) => i.key)).toEqual(['audioBytes', 'audioLength'])
    expect(summaryIssues({ ...base, fileBytes: 200_000, duration: 3 })).toEqual([])
  })

  it('claims audio files', () => {
    expect(audioHandler.match({ path: 'A/SFX_Coin.WAV', type: 'blob', sha: 'x' })).toBe(true)
    expect(audioHandler.match({ path: 'A/SFX_Coin.wav.meta', type: 'blob', sha: 'x' })).toBe(false)
  })
})

import { audioHeader } from '../audio/header'

describe('audioHeader', () => {
  it('reads WAV fmt, OGG Vorbis identification and MP3 frame headers', () => {
    const wav = new Uint8Array(44)
    const dv = new DataView(wav.buffer)
    wav.set(new TextEncoder().encode('RIFF'), 0)
    wav.set(new TextEncoder().encode('WAVEfmt '), 8)
    dv.setUint32(16, 16, true)
    dv.setUint16(22, 2, true)
    dv.setUint32(24, 48000, true)
    expect(audioHeader('a.wav', wav)).toEqual({ format: 'WAV', channels: 2, sampleRate: 48000 })

    const ogg = new Uint8Array(64)
    ogg.set(new TextEncoder().encode('OggS'), 0)
    ogg.set(new TextEncoder().encode('\x01vorbis'), 28)
    ogg[28 + 11] = 1
    new DataView(ogg.buffer).setUint32(28 + 12, 22050, true)
    expect(audioHeader('a.ogg', ogg)).toEqual({ format: 'OGG', channels: 1, sampleRate: 22050 })

    // ID3 tag of 4 bytes, then an MPEG-1 Layer III frame at 44.1 kHz, joint stereo.
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x44, 0, 0])
    expect(audioHeader('a.mp3', mp3)).toEqual({ format: 'MP3', sampleRate: 44100, channels: 2 })
  })
})
