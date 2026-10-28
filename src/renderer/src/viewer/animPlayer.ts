import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { modelImportScale, sampleCurve, type AnimClipInfo } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'

/** Rigs bigger than this are not downloaded to try a clip on. */
export const MAX_RIG_BYTES = 30 * 1024 * 1024
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
/** The animated root's name in tracks ("" paths in Unity). */
const ROOT = '__clipRoot'

const sanitize = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name)
const leaf = (path: string) => path.split('/').pop() ?? ''

/** A model loaded to play clips on: in file units, with Unity's import scale to convert clip positions. */
export interface Rig {
  path: string
  root: THREE.Group
  /** Unity units per file unit (UnitScaleFactor / 100 × globalScale). */
  factor: number
  bytes: number
}

export async function loadRig(live: LiveContext, path: string): Promise<Rig> {
  const [bytes, meta] = await Promise.all([
    window.api.assets.readFile(live.repo, live.branch, path).then(unwrap),
    window.api.assets.readFile(live.repo, live.branch, `${path}.meta`).then((r) => (r.ok ? new TextDecoder().decode(r.data) : ''))
  ])
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(() => TRANSPARENT_PNG)
  const root = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
  root.name = ROOT
  const { globalScale, useFileScale } = modelImportScale(meta)
  const unit = Number(root.userData.unitScaleFactor) || 1
  return { path, root, factor: (useFileScale ? unit / 100 : 1) * globalScale, bytes: bytes.byteLength }
}

/** Share of the clip's animated objects the rig has, by name (0–1). */
export function rigCoverage(info: AnimClipInfo, root: THREE.Object3D): number {
  const names = new Set<string>()
  root.traverse((o) => names.add(o.name))
  const wanted = [...new Set(info.transformCurves.map((c) => c.path).filter(Boolean).map((p) => sanitize(leaf(p))))]
  if (!wanted.length) return info.transformCurves.length ? 1 : 0
  return wanted.filter((n) => names.has(n)).length / wanted.length
}

/**
 * The clip as a three.js clip on `rig`: curves sampled at the clip's rate
 * (at least 30 fps), mirrored from Unity's left-handed axes, positions back
 * in file units. Objects the rig does not have are left out.
 */
export function toThreeClip(info: AnimClipInfo, rig: Rig): THREE.AnimationClip {
  const fps = Math.min(60, Math.max(30, info.sampleRate))
  const frames = Math.max(2, Math.ceil(info.length * fps) + 1)
  const times = Float32Array.from({ length: frames }, (_, i) => Math.min(info.length, i / fps))
  const names = new Set<string>()
  rig.root.traverse((o) => names.add(o.name))
  const tracks: THREE.KeyframeTrack[] = []
  const euler = new THREE.Euler()
  const q = new THREE.Quaternion()
  for (const curve of info.transformCurves) {
    const name = curve.path ? sanitize(leaf(curve.path)) : ROOT
    if (!names.has(name)) continue
    const at = (t: number) => sampleCurve(curve.keys, t)
    // Root motion would carry the model out of the framed view: left out.
    if (curve.kind === 'position' && !curve.path) continue
    if (curve.kind === 'position') {
      const f = rig.factor || 1
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, [...times].flatMap((t) => { const [x, y, z] = at(t); return [-x / f, y / f, z / f] })))
    } else if (curve.kind === 'scale') {
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times, [...times].flatMap((t) => at(t))))
    } else {
      const values: number[] = []
      let prev: THREE.Quaternion | undefined
      for (const t of times) {
        const v = at(t)
        if (curve.kind === 'rotation') q.set(v[0], v[1], v[2], v[3]).normalize()
        // Unity's Euler angles turn Z, then X, then Y: three's 'YXZ'.
        else q.setFromEuler(euler.set(THREE.MathUtils.degToRad(v[0]), THREE.MathUtils.degToRad(v[1]), THREE.MathUtils.degToRad(v[2]), 'YXZ'))
        const m = new THREE.Quaternion(q.x, -q.y, -q.z, q.w)
        // Keep neighbouring keys on the same hemisphere so interpolation takes the short way.
        if (prev && prev.dot(m) < 0) m.set(-m.x, -m.y, -m.z, -m.w)
        values.push(m.x, m.y, m.z, m.w)
        prev = m
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values))
    }
  }
  return new THREE.AnimationClip(info.name || 'clip', info.length || -1, tracks)
}
