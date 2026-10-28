import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import type { ModelStats } from '@core/checks/playable'
import type { MaterialLook } from '@core/index'

export type ViewPreset = 'front' | 'side' | 'top' | 'reset'

/** Shape a material is shown on. */
export type PreviewShape = 'sphere' | 'cube' | 'plane'

/** A texture file fetched from the repo, served to three.js through a blob URL. */
export interface TextureFile {
  name: string
  url: string
  bytes: number
  width?: number
  height?: number
}

/** A .mat texture slot to apply to the FBX material with the same name (kind A); '*' applies to every material. */
export interface MaterialSlot {
  material: string
  prop: string
  file: TextureFile
}

const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
/** In priority order: URP's _BaseMap wins over the legacy _MainTex that URP materials also keep. */
const COLOR_ORDER = ['_basemap', '_basecolormap', '_albedo', '_maintex', '_diffuse']
const COLOR_PROPS = new Set(COLOR_ORDER)
const slotRank = (prop: string) => (COLOR_PROPS.has(prop) ? COLOR_ORDER.indexOf(prop) : COLOR_ORDER.length)
const NORMAL_PROPS = new Set(['_bumpmap', '_normalmap'])
const EMISSION_PROPS = new Set(['_emissionmap'])

const baseLower = (url: string) => decodeURIComponent(url).split(/[\\/]/).pop()!.toLowerCase()

/** Imperative three.js viewer: orbit/zoom/pan, view presets, wireframe, animations, thumbnails. */
export class FbxViewer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6)
  private readonly controls: OrbitControls
  private readonly clock = new THREE.Clock()
  private readonly resize: ResizeObserver
  private model?: THREE.Group
  private mixer?: THREE.AnimationMixer
  private grid?: THREE.GridHelper
  private home = { position: new THREE.Vector3(), target: new THREE.Vector3(), radius: 1 }
  private frame = 0
  private disposed = false

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x1e222b)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4b, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(3, 5, 4)
    this.scene.add(sun)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.autoRotateSpeed = 2
    this.resize = new ResizeObserver(() => this.fitCanvas())
    this.resize.observe(host)
    this.fitCanvas()
    this.loop()
  }

  /**
   * Parses the FBX; texture names inside it are served from `textures` (keyed
   * by lower-case file name). Resolves once those textures have loaded (or
   * after a short timeout), so a snapshot taken then shows them.
   */
  load(fbx: ArrayBuffer, textures: ReadonlyMap<string, TextureFile>): Promise<void> {
    const manager = new THREE.LoadingManager()
    let started = false
    const loaded = new Promise<void>((resolve) => {
      manager.onLoad = () => resolve()
      setTimeout(resolve, 4000)
    })
    manager.onStart = () => (started = true)
    manager.setURLModifier((url) => textures.get(baseLower(url))?.url ?? TRANSPARENT_PNG)
    manager.addHandler(/\.tga$/i, new TGALoader(manager))
    const model = new FBXLoader(manager).parse(fbx, '')
    this.model = model
    this.scene.add(model)
    this.frameModel()
    if (model.animations.length) this.mixer = new THREE.AnimationMixer(model)
    return started ? loaded : Promise.resolve()
  }

  /**
   * Shows a plain shape instead of a model, with one material that
   * `applyMaterialSlots` ('*') and `setLook` dress. Switching shape keeps that material.
   */
  showShape(shape: PreviewShape): void {
    const geometry =
      shape === 'sphere' ? new THREE.SphereGeometry(0.5, 64, 32) : shape === 'cube' ? new THREE.BoxGeometry(0.7, 0.7, 0.7) : new THREE.PlaneGeometry(1, 1)
    const mesh = this.model?.children[0] as THREE.Mesh | undefined
    if (mesh?.isMesh) {
      mesh.geometry.dispose()
      mesh.geometry = geometry
    } else {
      const group = new THREE.Group()
      group.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ name: 'preview', side: THREE.DoubleSide })))
      this.model = group
      this.scene.add(group)
    }
    this.model!.position.set(0, 0, 0)
    this.frameModel()
    // A flat card is read face-on.
    if (shape === 'plane') this.setView('front')
  }

  /** Shows a group put together elsewhere (a prefab) like a loaded model. */
  showGroup(group: THREE.Group): void {
    if (this.model) this.scene.remove(this.model)
    this.mixer?.stopAllAction()
    this.mixer = undefined
    this.model = group
    this.scene.add(group)
    this.frameModel()
  }

  /** Colour, transparency, cutout, emission and gloss from a Unity material, on top of its textures; `only` limits it to one material by name. */
  setLook(look: MaterialLook, only?: string): void {
    this.model?.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (only !== undefined && mat.name !== only) continue
        const m = mat as THREE.MeshPhongMaterial
        // Unity stores colour properties in sRGB; they multiply the colour texture. HDR colours (> 1) would only blow out.
        const c01 = (v: number) => Math.min(1, Math.max(0, v))
        if (look.color) m.color.setRGB(c01(look.color.r), c01(look.color.g), c01(look.color.b), THREE.SRGBColorSpace)
        m.transparent = look.surface === 'transparent'
        m.opacity = m.transparent ? (look.color?.a ?? 1) : 1
        m.depthWrite = !m.transparent
        m.alphaTest = look.surface === 'cutout' ? (look.cutoff ?? 0.5) : 0
        if (look.emission) m.emissive.setRGB(c01(look.emission.r), c01(look.emission.g), c01(look.emission.b), THREE.SRGBColorSpace)
        else m.emissive.set(0x000000)
        const smooth = look.smoothness ?? 0.5
        m.shininess = 4 + smooth * 96
        m.specular.setScalar(0.05 + smooth * 0.35)
        m.needsUpdate = true
      }
    })
  }

  /** Puts .mat textures onto the FBX materials with matching names. */
  async applyMaterialSlots(slots: readonly MaterialSlot[], exact = false): Promise<void> {
    if (!this.model || !slots.length) return
    const byMaterial = new Map<string, MaterialSlot[]>()
    const ordered = [...slots].sort((a, b) => slotRank(a.prop.toLowerCase()) - slotRank(b.prop.toLowerCase()))
    for (const s of ordered) {
      const key = s.material.toLowerCase()
      byMaterial.set(key, [...(byMaterial.get(key) ?? []), s])
    }
    const loadTex = (file: TextureFile, color: boolean) =>
      new Promise<THREE.Texture | undefined>((resolve) => {
        const loader: THREE.Loader<THREE.Texture> = file.name.toLowerCase().endsWith('.tga') ? new TGALoader() : new THREE.TextureLoader()
        loader.load(
          file.url,
          (tex) => {
            if (color) tex.colorSpace = THREE.SRGBColorSpace
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping
            resolve(tex)
          },
          undefined,
          () => resolve(undefined)
        )
      })
    const jobs: Promise<void>[] = []
    this.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const m = mat as THREE.MeshPhongMaterial
        // `exact`: only materials named in the slots (a prefab's materials are named by GUID).
        const slotsFor = exact
          ? byMaterial.get(m.name.toLowerCase())
          : (byMaterial.get(m.name.toLowerCase()) ?? byMaterial.get('*') ?? (byMaterial.size === 1 ? [...byMaterial.values()][0] : undefined))
        let colorTaken = false
        for (const slot of slotsFor ?? []) {
          const prop = slot.prop.toLowerCase()
          const color = COLOR_PROPS.has(prop)
          if (!color && !NORMAL_PROPS.has(prop) && !EMISSION_PROPS.has(prop)) continue
          // One colour map per material: the highest-priority slot.
          if (color && colorTaken) continue
          if (color) colorTaken = true
          jobs.push(
            loadTex(slot.file, color || EMISSION_PROPS.has(prop)).then((tex) => {
              if (!tex || this.disposed) return
              const replace = (old: THREE.Texture | null) => old !== tex && old?.dispose()
              if (color) {
                replace(m.map)
                m.map = tex
                m.color?.set(0xffffff)
              } else if (NORMAL_PROPS.has(prop)) {
                replace(m.normalMap)
                m.normalMap = tex
              } else {
                replace(m.emissiveMap)
                m.emissiveMap = tex
                m.emissive?.set(0xffffff)
              }
              m.needsUpdate = true
            })
          )
        }
      }
    })
    await Promise.all(jobs)
  }

  /** True when at least one material got a colour texture from the FBX itself. */
  hasColorMaps(): boolean {
    let found = false
    this.model?.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if ((m as THREE.MeshPhongMaterial).map) found = true
    })
    return found
  }

  stats(fileBytes: number, textures: readonly TextureFile[]): ModelStats {
    let triangles = 0
    let vertices = 0
    let meshes = 0
    const materials = new Set<string>()
    const bones = new Set<string>()
    this.model?.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      meshes++
      const geo = mesh.geometry
      const pos = geo.getAttribute('position')
      vertices += pos?.count ?? 0
      triangles += Math.floor((geo.index ? geo.index.count : (pos?.count ?? 0)) / 3)
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m.uuid)
      const skinned = obj as THREE.SkinnedMesh
      if (skinned.isSkinnedMesh) skinned.skeleton.bones.forEach((b) => bones.add(b.uuid))
    })
    return {
      triangles,
      vertices,
      meshes,
      materials: materials.size,
      bones: bones.size,
      animations: this.model?.animations.map((a, i) => a.name || `Clip ${i + 1}`) ?? [],
      textures: textures.map((t) => ({ name: t.name, width: t.width, height: t.height, bytes: t.bytes })),
      fileBytes
    }
  }

  setView(preset: ViewPreset): void {
    const { target, radius } = this.home
    const d = radius * 2.4
    const pos =
      preset === 'front'
        ? new THREE.Vector3(0, radius * 0.4, d)
        : preset === 'side'
          ? new THREE.Vector3(d, radius * 0.4, 0)
          : preset === 'top'
            ? new THREE.Vector3(0, d, 0.0001)
            : this.home.position.clone().sub(target)
    this.camera.position.copy(target).add(pos)
    this.controls.target.copy(target)
    this.controls.update()
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on
  }

  setWireframe(on: boolean): void {
    this.model?.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshPhongMaterial).wireframe = on
    })
  }

  /** Plays a clip made elsewhere (an .anim file) on the shown model, looping or once; null stops. */
  playClip(clip: THREE.AnimationClip | null, loop = true): void {
    this.mixer?.stopAllAction()
    if (!clip || !this.model) return
    this.mixer ??= new THREE.AnimationMixer(this.model)
    const action = this.mixer.clipAction(clip)
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = true
    action.reset().play()
  }

  /** Moves what is playing to `seconds` (for a still pose). */
  poseAt(seconds: number): void {
    this.mixer?.setTime(seconds)
  }

  /** Pauses or resumes whatever is playing. */
  setPaused(paused: boolean): void {
    if (this.mixer) this.mixer.timeScale = paused ? 0 : 1
  }

  /** Plays one animation clip, or stops when `index` is null. */
  playAnimation(index: number | null): void {
    if (!this.mixer || !this.model) return
    this.mixer.stopAllAction()
    if (index !== null && this.model.animations[index]) this.mixer.clipAction(this.model.animations[index]).play()
  }

  /** Small preview image of the current view. */
  snapshot(width = 320, height = 240): string {
    this.renderer.render(this.scene, this.camera)
    const src = this.renderer.domElement
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const scale = Math.max(width / src.width, height / src.height)
    const w = src.width * scale
    const h = src.height * scale
    ctx.drawImage(src, (width - w) / 2, (height - h) / 2, w, h)
    return canvas.toDataURL('image/webp', 0.85)
  }

  isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    this.controls.dispose()
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      mesh.geometry?.dispose()
      for (const m of mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
        m.dispose()
      }
    })
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  private frameModel(): void {
    if (!this.model) return
    const box = new THREE.Box3().setFromObject(this.model)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // Centre on the origin and stand the model on the grid.
    this.model.position.sub(center).add(new THREE.Vector3(0, size.y / 2, 0))
    const radius = Math.max(size.length() / 2, 1e-3)
    const target = new THREE.Vector3(0, size.y / 2, 0)
    this.camera.near = radius / 100
    this.camera.far = radius * 100
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = radius * 0.2
    this.controls.maxDistance = radius * 20
    this.home = { position: target.clone().add(new THREE.Vector3(radius * 1.6, radius * 0.9, radius * 1.9)), target, radius }
    if (this.grid) this.scene.remove(this.grid)
    this.grid = new THREE.GridHelper(radius * 6, 24, 0x3a4150, 0x2a2f3a)
    this.scene.add(this.grid)
    this.setView('reset')
  }

  private fitCanvas(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    this.mixer?.update(this.clock.getDelta())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
