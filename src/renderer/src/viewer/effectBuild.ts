import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { modelImportScale, parseMaterialLook, type DependencyReport, type MaterialLook, type ParticleEmitter } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { mainTexture } from './particleThumb'
import { EffectPlayer, EmitterPlayer, type EmitterLook } from './particlePlayer'
import { fetchTextureFile } from './textures'
import { unwrap } from '../remoteSource'

/** Mesh particles from models larger than this are drawn as billboards. */
const MAX_MESH_BYTES = 8 * 1024 * 1024

/** Blend from the shader's name when the material does not say (legacy "Particles/Additive"…). */
function blendFromShader(label: string | undefined): EmitterLook['blend'] {
  if (!label) return 'alpha'
  if (/add/i.test(label)) return 'additive'
  if (/premultipl/i.test(label)) return 'premultiply'
  if (/multipl/i.test(label)) return 'multiply'
  return 'alpha'
}

/**
 * Puts a player on every emitter of a built prefab: each gets its material's
 * main texture, colour and blend. Particles appear under the emitters' objects
 * as soon as the returned player is updated.
 */
export async function buildEffect(live: LiveContext, report: DependencyReport, anchors: ReadonlyArray<{ emitter: ParticleEmitter & { prefab?: string }; object: THREE.Object3D }>, background = false): Promise<EffectPlayer> {
  const byGuid = new Map(report.materials.flatMap((m) => (m.guid ? [[m.guid, m] as const] : [])))
  const textures = new Map<string, Promise<THREE.Texture | undefined>>()
  const looks = new Map<string, Promise<MaterialLook | undefined>>()
  let maxSide = 0
  const loadTexture = (path: string) => {
    let p = textures.get(path)
    if (!p) {
      p = fetchTextureFile(live, path, background).then(async (file) => {
        if (!file) return undefined
        try {
          const tex = await new THREE.TextureLoader().loadAsync(file.url)
          tex.colorSpace = THREE.SRGBColorSpace
          const img = tex.image as { width?: number; height?: number } | undefined
          maxSide = Math.max(maxSide, img?.width ?? 0, img?.height ?? 0)
          return tex
        } catch {
          return undefined
        } finally {
          URL.revokeObjectURL(file.url)
        }
      })
      textures.set(path, p)
    }
    return p
  }
  const loadLook = (path: string) => {
    let p = looks.get(path)
    if (!p) {
      p = window.api.assets.readFile(live.repo, live.branch, path, background).then((r) => (r.ok ? parseMaterialLook(new TextDecoder().decode(r.data)) : undefined))
      looks.set(path, p)
    }
    return p
  }

  const meshes = new Map<string, Promise<THREE.BufferGeometry | undefined>>()
  /** The first mesh of a model, in Unity's import units (what a mesh particle is). */
  const loadMesh = (path: string) => {
    let p = meshes.get(path)
    if (!p) {
      p = (async () => {
        try {
          const read = (f: string) => window.api.assets.readFile(live.repo, live.branch, f, background)
          const [bytes, meta] = await Promise.all([read(path).then(unwrap), read(`${path}.meta`).then((r) => (r.ok ? new TextDecoder().decode(r.data) : ''))])
          if (bytes.byteLength > MAX_MESH_BYTES) return undefined
          const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
          let mesh: THREE.Mesh | undefined
          root.traverse((o) => (mesh ??= (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : undefined))
          if (!mesh) return undefined
          const { globalScale, useFileScale } = modelImportScale(meta)
          const unit = Number(root.userData.unitScaleFactor) || 1
          const k = (useFileScale ? unit / 100 : 1) * globalScale
          return mesh.geometry.clone().scale(k, k, k)
        } catch {
          return undefined
        }
      })()
      meshes.set(path, p)
    }
    return p
  }
  /** Texture, colour and blend of one material. */
  const lookOf = async (guid: string | undefined): Promise<Omit<EmitterLook, 'mesh' | 'trail'>> => {
    const material = guid ? byGuid.get(guid) : undefined
    const texPath = mainTexture(material)
    const [texture, look] = await Promise.all([texPath ? loadTexture(texPath) : undefined, material?.path ? loadLook(material.path) : undefined])
    const c = look?.color
    return { texture, blend: look?.blend ?? blendFromShader(material?.shader?.label), tint: c ? [c.r, c.g, c.b, c.a] : [1, 1, 1, 1] }
  }

  const players = await Promise.all(
    anchors.map(async ({ emitter, object }) => {
      const meshPath = emitter.renderMode === 'mesh' && emitter.mesh ? report.guidPaths?.[emitter.mesh] : undefined
      const [look, trail, mesh] = await Promise.all([
        lookOf(emitter.material),
        emitter.sim.trail ? lookOf(emitter.trailMaterial ?? emitter.material) : undefined,
        meshPath && /\.fbx$/i.test(meshPath) ? loadMesh(meshPath) : undefined
      ])
      const player = new EmitterPlayer(emitter, { ...look, trail, mesh })
      object.add(player.mesh)
      return player
    })
  )

  // Sub emitters: the system each one names, in the same prefab — the one under the parent's object when it is placed twice.
  for (const [i, parent] of players.entries()) {
    for (const sub of parent.emitter.sim.subEmitters ?? []) {
      const candidates = players.filter((p) => p !== parent && p.emitter.id === sub.id && p.emitter.prefab === parent.emitter.prefab)
      const under = candidates.find((p) => {
        let o: THREE.Object3D | null = anchors[players.indexOf(p)].object
        for (; o; o = o.parent) if (o === anchors[i].object) return true
        return false
      })
      const child = under ?? candidates[0]
      if (!child) continue
      child.isSub = true
      parent.subs.push({ player: child, type: sub.type, inherit: sub.inherit, probability: sub.probability })
    }
  }
  // Sub emitters start empty: they wait for their parents' particles.
  for (const p of players) if (p.isSub) p.restart()
  const effect = new EffectPlayer(players)
  effect.maxTextureSize = maxSide
  const dispose = effect.dispose.bind(effect)
  effect.dispose = () => {
    dispose()
    for (const p of textures.values()) void p.then((t) => t?.dispose())
    for (const p of meshes.values()) void p.then((g) => g?.dispose())
  }
  return effect
}
