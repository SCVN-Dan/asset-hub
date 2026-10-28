import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { clone as cloneWithBones } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  fbxMeshNames,
  modelImportScale,
  parseFbxMeta,
  parseMaterialLook,
  parsePrefabScene,
  type DependencyReport,
  type MaterialLook,
  type PrefabScene,
  type Quat,
  type SceneInstance,
  type Vec3
} from '@core/index'
import type { LiveContext } from '../components/ModelViewer'
import { unwrap } from '../remoteSource'
import type { FbxViewer, MaterialSlot, TextureFile } from './FbxViewer'
import { DRAWABLE, fetchTextureFile } from './textures'

/** Nested prefabs are put together this deep, like the resolver follows them. */
const MAX_DEPTH = 4
/** Models bigger than this are left out of a prefab preview (shown as missing). */
const MAX_MODEL_BYTES = 40 * 1024 * 1024
/** Textures per prefab preview: colour and normal maps of the materials used most. */
const MAX_TEXTURES = 24
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** A prefab put together as a three.js group, with what is needed to dress and measure it. */
export interface PrefabBuild {
  group: THREE.Group
  /** Texture slots per material GUID, applied once the group is in a viewer. */
  slots: MaterialSlot[]
  looks: Map<string, MaterialLook>
  textures: TextureFile[]
  /** Bytes of the models downloaded. */
  modelBytes: number
  /** Meshes whose model could not be found or loaded. */
  missing: number
  meshes: number
  dispose(): void
}

interface ModelTemplate {
  root: THREE.Group
  /** Unity's import scale: file units to metres, times the import's global scale. */
  factor: number
  /** Mesh fileID → mesh name, when the .meta lists them. */
  names: Map<string, string>
  meshes: THREE.Mesh[]
  /** FBX material name → .mat GUID it is remapped to. */
  remap: Map<string, string>
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** Unity is left-handed; three.js right-handed: mirror along X. */
function setTransform(obj: THREE.Object3D, position?: Vec3, rotation?: Quat, scale?: Vec3) {
  if (position) obj.position.set(-position[0], position[1], position[2])
  if (rotation) obj.quaternion.set(rotation[0], -rotation[1], -rotation[2], rotation[3]).normalize()
  if (scale) obj.scale.set(scale[0], scale[1], scale[2])
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh))
  return out
}

/** "fbx_Rail_giant (2)" and "fbx_Rail_giant003" → "fbxrailgiant": duplicates and exporters add numbers. */
const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[._ -]?\d+$/, '')
    .replace(/[^a-z0-9]/g, '')

/** Length of the longest run two names share ("wooddoorr" / "doorr" → 5). */
function sharedRun(a: string, b: string): number {
  let best = 0
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > best) best = k
    }
  return best
}

/**
 * Which mesh of a model each mesh fileID the prefab uses stands for. Newer
 * Unity derives these fileIDs from names it does not list, so they are matched
 * through the GameObjects' names: listed names first, then equal names, then
 * the closest names (each mesh used once), and a last fileID gets the last mesh.
 * Unmatched fileIDs map to undefined: the whole model is shown there instead.
 */
function assignMeshes(tpl: ModelTemplate, refs: ReadonlyMap<string, readonly string[]>): Map<string, THREE.Mesh | undefined> {
  const out = new Map<string, THREE.Mesh | undefined>()
  const free = new Set(tpl.meshes)
  const meshName = (m: THREE.Mesh) => m.name || m.parent?.name || ''
  const take = (fileID: string, mesh: THREE.Mesh) => {
    out.set(fileID, mesh)
    free.delete(mesh)
  }
  for (const [fileID, names] of refs) {
    const wanted = [tpl.names.get(fileID), ...names].filter((n): n is string => !!n).map((n) => n.toLowerCase())
    const hit = [...free].find((m) => wanted.includes(meshName(m).toLowerCase()))
    if (hit) take(fileID, hit)
  }
  const pairs: Array<{ fileID: string; mesh: THREE.Mesh; score: number }> = []
  for (const [fileID, names] of refs) {
    if (out.has(fileID)) continue
    for (const mesh of free) {
      const n = normName(meshName(mesh))
      const score = Math.max(...names.map((name) => (normName(name) === n ? 1000 : sharedRun(normName(name), n))))
      if (score >= 3) pairs.push({ fileID, mesh, score })
    }
  }
  for (const p of pairs.sort((a, b) => b.score - a.score)) if (!out.has(p.fileID) && free.has(p.mesh)) take(p.fileID, p.mesh)
  const open = [...refs.keys()].filter((f) => !out.has(f))
  if (open.length === 1 && free.size === 1) take(open[0], [...free][0])
  return out
}

/**
 * Downloads a prefab's models (and the prefabs nested in it), places every
 * mesh where the prefab puts it, with its materials. Textures are fetched
 * here and applied by the viewer (`slots`, `looks`).
 */
export async function buildPrefab(live: LiveContext, path: string, report: DependencyReport, background = false): Promise<PrefabBuild> {
  const guidPaths = report.guidPaths ?? {}
  const read = (p: string) => window.api.assets.readFile(live.repo, live.branch, p, background).then(unwrap)
  const readText = (p: string) => read(p).then(decode)
  const readOptional = (p: string) => window.api.assets.readFile(live.repo, live.branch, p, background).then((r) => (r.ok ? decode(r.data) : undefined))

  // The prefab and the prefabs nested in it.
  const scenes = new Map<string, PrefabScene>()
  let frontier = [path]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const texts = await Promise.all(frontier.map((p) => readText(p).catch(() => '')))
    frontier.forEach((p, i) => scenes.set(p, parsePrefabScene(texts[i])))
    frontier = [
      ...new Set(
        frontier.flatMap((p) => scenes.get(p)!.instances.map((inst) => guidPaths[inst.source])).filter((p): p is string => !!p && /\.prefab$/i.test(p) && !scenes.has(p))
      )
    ]
  }

  // Each model once, parsed without its textures (materials come from the prefab).
  const modelPaths = new Set<string>()
  for (const s of scenes.values()) {
    for (const m of s.meshes) if (guidPaths[m.mesh.guid]) modelPaths.add(guidPaths[m.mesh.guid])
    for (const inst of s.instances) {
      const p = guidPaths[inst.source]
      if (p && !/\.prefab$/i.test(p)) modelPaths.add(p)
    }
  }
  let modelBytes = 0
  const templates = new Map<string, ModelTemplate>()
  await Promise.all(
    [...modelPaths].map(async (p) => {
      if (!/\.fbx$/i.test(p)) return
      try {
        const [bytes, meta] = await Promise.all([read(p), readOptional(`${p}.meta`)])
        if (bytes.byteLength > MAX_MODEL_BYTES) return
        modelBytes += bytes.byteLength
        const manager = new THREE.LoadingManager()
        manager.setURLModifier(() => TRANSPARENT_PNG)
        const root = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
        const { globalScale, useFileScale } = modelImportScale(meta ?? '')
        const unit = Number(root.userData.unitScaleFactor) || 1
        templates.set(p, {
          root,
          factor: (useFileScale ? unit / 100 : 1) * globalScale,
          names: fbxMeshNames(meta ?? ''),
          meshes: meshesOf(root),
          remap: new Map(parseFbxMeta(meta ?? '').externalMaterials.map((m) => [m.name.toLowerCase(), m.guid]))
        })
      } catch {
        // Left out of the preview; counted as missing below.
      }
    })
  )

  // Mesh fileIDs of each model, with the names of the GameObjects using them, matched to the model's meshes.
  const refs = new Map<string, Map<string, string[]>>()
  for (const s of scenes.values())
    for (const m of s.meshes) {
      const p = guidPaths[m.mesh.guid]
      if (!p) continue
      const byId = refs.get(p) ?? new Map<string, string[]>()
      byId.set(m.mesh.fileID, [...(byId.get(m.mesh.fileID) ?? []), s.nodes.get(m.node)?.name ?? ''])
      refs.set(p, byId)
    }
  const assigned = new Map([...refs].flatMap(([p, byId]) => (templates.has(p) ? [[p, assignMeshes(templates.get(p)!, byId)] as const] : [])))

  // One material per .mat GUID, named by it so texture slots find it.
  const materials = new Map<string, THREE.MeshPhongMaterial>()
  const fallback = new THREE.MeshPhongMaterial({ color: 0x9aa3b2, name: 'missing' })
  const materialFor = (guid: string | undefined) => {
    if (!guid || !guidPaths[guid]) return fallback
    let m = materials.get(guid)
    if (!m) {
      m = new THREE.MeshPhongMaterial({ name: guid, side: THREE.FrontSide })
      materials.set(guid, m)
    }
    return m
  }
  const dress = (mesh: THREE.Mesh, guids: readonly string[]) => {
    const count = Array.isArray(mesh.material) ? mesh.material.length : 1
    const list = Array.from({ length: count }, (_, i) => materialFor(guids[i] ?? guids[guids.length - 1]))
    mesh.material = count === 1 ? list[0] : list
  }

  let missing = 0
  let meshCount = 0
  const place = (scene: PrefabScene, parent: THREE.Object3D, depth: number, override?: SceneInstance) => {
    const objects = new Map<string, THREE.Object3D>()
    for (const node of scene.nodes.values()) {
      if (node.instance) continue
      const obj = new THREE.Object3D()
      obj.name = node.name
      setTransform(obj, node.position, node.rotation, node.scale)
      // An instance's overrides replace the nested prefab's root transform.
      if (!node.parent && override) setTransform(obj, override.position, override.rotation, override.scale)
      obj.visible = node.active
      objects.set(node.id, obj)
    }
    for (const node of scene.nodes.values()) {
      const obj = objects.get(node.id)
      if (!obj) continue
      if (!node.parent) parent.add(obj)
      // A parent inside a nested instance (stripped) exists only once instances are placed: second pass below.
      else objects.get(node.parent)?.add(obj)
    }
    for (const inst of scene.instances) {
      const container = new THREE.Group()
      const at = inst.parent ? objects.get(inst.parent) : undefined
      ;(at ?? parent).add(container)
      const source = guidPaths[inst.source]
      if (source && /\.prefab$/i.test(source)) {
        const nested = scenes.get(source)
        if (nested && depth < MAX_DEPTH) place(nested, container, depth + 1, inst)
      } else {
        const tpl = source ? templates.get(source) : undefined
        if (!tpl) {
          missing++
        } else {
          const model = cloneWithBones(tpl.root)
          model.scale.setScalar(tpl.factor)
          container.add(model)
          setTransform(container, inst.position, inst.rotation, inst.scale)
          for (const mesh of meshesOf(model)) {
            meshCount++
            const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => tpl.remap.get(m.name.toLowerCase()) ?? '')
            dress(mesh, inst.materials.length ? inst.materials : own)
          }
        }
      }
      // Objects of this prefab placed under the instance (stripped transforms) hang on its container.
      for (const node of scene.nodes.values()) if (node.instance === inst.id) objects.set(node.id, container)
    }
    // A second pass: children of stripped transforms could only be attached once instances exist.
    for (const node of scene.nodes.values()) {
      const obj = objects.get(node.id)
      if (obj && !node.instance && node.parent && !obj.parent) objects.get(node.parent)?.add(obj)
    }
    for (const m of scene.meshes) {
      const obj = objects.get(m.node)
      const modelPath = guidPaths[m.mesh.guid] ?? ''
      const tpl = templates.get(modelPath)
      if (!obj || !tpl) {
        missing++
        continue
      }
      meshCount++
      const source = assigned.get(modelPath)?.get(m.mesh.fileID) ?? (tpl.meshes.length === 1 ? tpl.meshes[0] : undefined)
      if (source) {
        const mesh = new THREE.Mesh(source.geometry, source.material)
        mesh.scale.setScalar(tpl.factor)
        dress(mesh, m.materials)
        obj.add(mesh)
      } else {
        // Which mesh of the model is unknown: show the whole model rather than nothing.
        const model = cloneWithBones(tpl.root)
        model.scale.setScalar(tpl.factor)
        for (const mesh of meshesOf(model)) dress(mesh, m.materials)
        obj.add(model)
      }
    }
  }

  const group = new THREE.Group()
  place(scenes.get(path) ?? parsePrefabScene(''), group, 0)

  // Textures and looks of the materials used, most used first.
  const used = [...materials.keys()]
  const byGuid = new Map(report.materials.flatMap((m) => (m.guid ? [[m.guid, m] as const] : [])))
  const looks = new Map<string, MaterialLook>()
  await Promise.all(
    used.map(async (guid) => {
      const text = await readOptional(guidPaths[guid])
      if (text) looks.set(guid, parseMaterialLook(text))
    })
  )
  const wanted = used.flatMap((guid) => (byGuid.get(guid)?.textures ?? []).filter((t) => t.path && DRAWABLE.test(t.path)).map((t) => ({ guid, prop: t.prop ?? '', path: t.path! })))
  const paths = [...new Set(wanted.map((w) => w.path))].slice(0, MAX_TEXTURES)
  const files = new Map<string, TextureFile>()
  await Promise.all(
    paths.map(async (p) => {
      const f = await fetchTextureFile(live, p, background)
      if (f) files.set(p, f)
    })
  )
  const slots: MaterialSlot[] = wanted.flatMap((w) => (files.has(w.path) ? [{ material: w.guid, prop: w.prop, file: files.get(w.path)! }] : []))

  return {
    group,
    slots,
    looks,
    textures: [...files.values()],
    modelBytes,
    missing,
    meshes: meshCount,
    dispose: () => {
      files.forEach((f) => URL.revokeObjectURL(f.url))
      for (const tpl of templates.values()) for (const m of tpl.meshes) m.geometry.dispose()
    }
  }
}

/** Puts a build's textures and material looks on it, once it is shown in `viewer`. */
export async function dressPrefab(viewer: FbxViewer, build: PrefabBuild): Promise<void> {
  await viewer.applyMaterialSlots(build.slots, true)
  for (const [guid, look] of build.looks) viewer.setLook(look, guid)
}
