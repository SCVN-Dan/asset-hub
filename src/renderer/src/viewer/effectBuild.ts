import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { meshForFileId, modelImportScale, parseMaterialLook, shaderBlend, shaderTextureProps, type BuiltinMesh, type DependencyReport, type MaterialLook, type ParticleEmitter } from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { mainTexture } from './particleThumb'
import { EffectPlayer, EmitterPlayer, type EmitterLook } from './particlePlayer'
import { fetchTextureFile } from './textures'
import { unwrap } from '../remoteSource'

/** Mesh particles from models larger than this are drawn as billboards. */
const MAX_MESH_BYTES = 8 * 1024 * 1024

/** Unity's own meshes at their sizes (Quad and Plane facing along Z and Y like Unity's). */
function builtinGeometry(mesh: BuiltinMesh): THREE.BufferGeometry {
  switch (mesh) {
    case 'quad':
      return new THREE.PlaneGeometry(1, 1)
    case 'plane':
      return new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2)
    case 'cube':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 24, 16)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 2, 24)
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 8, 16)
  }
}

/** Unity's legacy particle shaders blend one fixed way, whatever numbers their materials kept from another shader. */
const FIXED_BLEND = /^(Legacy Shaders|Mobile)\/Particles\//

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

  const shaders = new Map<string, Promise<{ blend?: EmitterLook['blend']; textures: string[] } | undefined>>()
  /** What a project shader tells: the blend its code fixes, if it does, and the texture slots it reads. */
  const loadShader = (path: string) => {
    let p = shaders.get(path)
    if (!p) {
      p = window.api.assets.readFile(live.repo, live.branch, path, background).then((r) => {
        if (!r.ok) return undefined
        const text = new TextDecoder().decode(r.data)
        return { blend: /\.shader$/i.test(path) ? shaderBlend(text) : undefined, textures: shaderTextureProps(path, text) }
      })
      shaders.set(path, p)
    }
    return p
  }

  const meshes = new Map<string, Promise<THREE.BufferGeometry | undefined>>()
  /** The mesh of a model a particle system names (by fileID; else its first), in Unity's import units. */
  const loadMesh = (path: string, fileID?: string) => {
    let p = meshes.get(`${path}#${fileID}`)
    if (!p) {
      p = (async () => {
        try {
          const read = (f: string) => window.api.assets.readFile(live.repo, live.branch, f, background)
          const [bytes, meta] = await Promise.all([read(path).then(unwrap), read(`${path}.meta`).then((r) => (r.ok ? new TextDecoder().decode(r.data) : ''))])
          if (bytes.byteLength > MAX_MESH_BYTES) return undefined
          const root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
          const all: THREE.Mesh[] = []
          root.traverse((o) => (o as THREE.Mesh).isMesh && all.push(o as THREE.Mesh))
          const named = fileID ? meshForFileId(all.map((m) => m.name || m.parent?.name || ''), fileID) : -1
          const mesh = all[Math.max(0, named)]
          if (!mesh) return undefined
          const { globalScale, useFileScale } = modelImportScale(meta)
          const unit = Number(root.userData.unitScaleFactor) || 1
          const k = (useFileScale ? unit / 100 : 1) * globalScale
          return mesh.geometry.clone().scale(k, k, k)
        } catch {
          return undefined
        }
      })()
      meshes.set(`${path}#${fileID}`, p)
    }
    return p
  }
  /** Texture, colour and blend of one material. */
  const lookOf = async (guid: string | undefined): Promise<Omit<EmitterLook, 'mesh' | 'trail'>> => {
    const material = guid ? byGuid.get(guid) : undefined
    const shader = material?.shader
    const info = shader?.kind === 'project' && shader.path ? await loadShader(shader.path) : undefined
    const coded = info?.blend
    const texPath = mainTexture(material, info?.textures)
    const [texture, look] = await Promise.all([texPath ? loadTexture(texPath) : undefined, material?.path ? loadLook(material.path) : undefined])
    const c = look?.color
    // A blend fixed by the shader wins over the material's numbers, which may be left from another shader.
    const fixed = shader && FIXED_BLEND.test(shader.label) ? blendFromShader(shader.label) : coded
    return { texture, blend: fixed ?? look?.blend ?? blendFromShader(shader?.label), tint: c ? [c.r, c.g, c.b, c.a] : [1, 1, 1, 1] }
  }

  const players = await Promise.all(
    anchors.map(async ({ emitter, object }) => {
      const meshPath = emitter.renderMode === 'mesh' && emitter.mesh ? report.guidPaths?.[emitter.mesh] : undefined
      const [look, trail, mesh] = await Promise.all([
        lookOf(emitter.material),
        emitter.sim.trail ? lookOf(emitter.trailMaterial ?? emitter.material) : undefined,
        meshPath && /\.fbx$/i.test(meshPath) ? loadMesh(meshPath, emitter.meshFileID) : emitter.renderMode === 'mesh' && emitter.builtinMesh ? builtinGeometry(emitter.builtinMesh) : undefined
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
