import type { StatsSummary } from '@core/checks/playable'
import { audioHeader, builtAudioBytes, parseAudioMeta, type AudioImport } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'

/** A decoded clip with what the audio panel reports about it. */
export interface DecodedAudio {
  duration: number
  /** Of the file (Web Audio resamples what it decodes). */
  sampleRate: number
  channels: number
  format: string
  bytes: number
  /** Min / max per column across all channels, for the waveform. */
  peaks: Float32Array
  import?: AudioImport
}

const COLUMNS = 800
let decoder: OfflineAudioContext | undefined

/** Decodes a clip and reduces it to waveform peaks; the samples themselves are not kept. */
export async function decodeAudio(path: string, bytes: Uint8Array, metaText?: string): Promise<DecodedAudio> {
  decoder ??= new OfflineAudioContext(1, 1, 44100)
  const buffer = await decoder.decodeAudioData(bytes.slice().buffer)
  const header = audioHeader(path, bytes)
  const peaks = new Float32Array(COLUMNS * 2)
  const step = Math.max(1, Math.floor(buffer.length / COLUMNS))
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let col = 0; col < COLUMNS; col++) {
      let min = peaks[col * 2]
      let max = peaks[col * 2 + 1]
      for (let i = col * step, end = Math.min(data.length, i + step); i < end; i++) {
        if (data[i] < min) min = data[i]
        if (data[i] > max) max = data[i]
      }
      peaks[col * 2] = min
      peaks[col * 2 + 1] = max
    }
  }
  return {
    duration: buffer.duration,
    sampleRate: header.sampleRate ?? buffer.sampleRate,
    channels: header.channels ?? buffer.numberOfChannels,
    format: header.format,
    bytes: bytes.byteLength,
    peaks,
    import: metaText ? parseAudioMeta(metaText) : undefined
  }
}

/** Draws the waveform; columns left of `progress` (0–1) in the played colour. */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: Float32Array, colors: { wave: string; played?: string; background?: string }, progress = 0): void {
  const g = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  if (colors.background) {
    g.fillStyle = colors.background
    g.fillRect(0, 0, w, h)
  } else g.clearRect(0, 0, w, h)
  const columns = peaks.length / 2
  const mid = h / 2
  for (let x = 0; x < w; x++) {
    const col = Math.floor((x / w) * columns)
    const min = peaks[col * 2]
    const max = peaks[col * 2 + 1]
    g.fillStyle = colors.played && x / w < progress ? colors.played : colors.wave
    const top = mid - max * mid * 0.95
    g.fillRect(x, top, 1, Math.max(1, (max - min) * mid * 0.95))
  }
}

export function audioStats(a: DecodedAudio): StatsSummary {
  return {
    triangles: 0,
    vertices: 0,
    bones: 0,
    clips: 0,
    materials: 0,
    fileBytes: Math.round(builtAudioBytes(a.duration, a.sampleRate, a.channels, a.import)),
    textureBytes: 0,
    maxTextureSize: 0,
    duration: a.duration,
    source: 'viewer'
  }
}

/** Grid thumbnail of a clip: its waveform, plus its length and estimated built size. */
export async function renderAudioThumbnail(live: LiveContext, path: string): Promise<{ url: string; stats: StatsSummary }> {
  const [bytes, meta] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path, true).then(unwrap),
    window.api.assets.readFile(live.repo, live.branch, `${path}.meta`, true).then((r) => (r.ok ? new TextDecoder().decode(r.data) : undefined))
  ])
  const audio = await decodeAudio(path, bytes, meta)
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  drawWaveform(canvas, audio.peaks, { wave: '#6c9cff', background: '#1a1e26' })
  return { url: canvas.toDataURL('image/webp', 0.85), stats: audioStats(audio) }
}

/** 75.4 → "1:15". */
export function formatDuration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} s`
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
