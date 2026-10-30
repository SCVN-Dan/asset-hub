import { baseName } from '../registry'
import type { TreeEntry } from '../types'
import { parsePrefabScene, type PrefabScene } from '../unity/prefabScene'
import { parseParticleSystems } from '../unity/particles'
import { BUILTIN_SHADER_GUIDS, parseFbxMeta } from '../unity/yaml'
import { describeMaterials, type DepContext } from './fbx'
import type { DependencyReport, DependencyWarning, PartRef } from './types'

/** Nested prefabs are followed this deep (a prefab inside a prefab inside a prefab…). */
const MAX_DEPTH = 4
const KIND_ORDER: Record<PartRef['kind'], number> = { model: 0, prefab: 1, script: 2, other: 3 }
const entrySize = (e: TreeEntry | undefined) => (e ? (e.lfs ? (e.lfsSize ?? e.size) : e.size) : undefined)
/** Unity's own resources (default font, built-in shaders and sprites) have GUIDs of mostly zeros. */
const isBuiltin = (guid: string) => /^0{16}/.test(guid) || BUILTIN_SHADER_GUIDS.has(guid)

/**
 * A prefab's dependencies: the models its meshes come from, nested prefabs
 * (followed a few levels), materials with their shaders and textures, custom
 * scripts, and anything else it references (sprites, audio, animators).
 */
export async function resolvePrefabDependencies(prefabPath: string, ctx: DepContext): Promise<DependencyReport> {
  const warnings = new Set<DependencyWarning>()
  const files = new Set<string>()
  const addWithMeta = (p: string) => {
    files.add(p)
    if (ctx.byPath.has(`${p}.meta`)) files.add(`${p}.meta`)
  }
  addWithMeta(prefabPath)
  if (!ctx.byPath.has(`${prefabPath}.meta`)) warnings.add('noMeta')

  const scenes = new Map<string, PrefabScene>()
  const particles: NonNullable<DependencyReport['particles']> = []
  const uses = new Map<string, number>()
  const kinds = new Map<string, 'model' | 'instance' | 'script'>()
  const count = (guid: string, kind: 'model' | 'instance' | 'script') => {
    if (!guid || isBuiltin(guid)) return
    uses.set(guid, (uses.get(guid) ?? 0) + 1)
    if (!kinds.has(guid)) kinds.set(guid, kind)
  }

  // The prefab, then the prefabs it nests, level by level; each level's GUIDs are looked up together.
  let frontier = [prefabPath]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const texts = await ctx.readTexts(frontier)
    const level: PrefabScene[] = []
    for (const p of frontier) {
      const text = texts.get(p) ?? ''
      const scene = parsePrefabScene(text)
      scenes.set(p, scene)
      level.push(scene)
      if (scene.particleSystems) particles.push(...parseParticleSystems(text).map((e) => (p === prefabPath ? e : { ...e, prefab: p })))
      scene.meshes.forEach((m) => count(m.mesh.guid, 'model'))
      scene.particleMeshes.forEach((g) => count(g, 'model'))
      scene.instances.forEach((i) => count(i.source, 'instance'))
      scene.scripts.forEach((g) => count(g, 'script'))
    }
    await Promise.all([
      ctx.prepare?.(level.flatMap((s) => [...s.meshes.map((m) => m.mesh.guid), ...s.particleMeshes]), 'model'),
      ctx.prepare?.(level.flatMap((s) => s.instances.map((i) => i.source)), 'prefab'),
      ctx.prepare?.(level.flatMap((s) => s.scripts), 'script')
    ])
    frontier = [
      ...new Set(
        level.flatMap((s) => s.instances.map((i) => ctx.pathForGuid(i.source))).filter((p): p is string => !!p && /\.prefab$/i.test(p) && !scenes.has(p))
      )
    ]
  }

  // Models bring the materials their own .meta maps (Unity re-links them on import).
  const modelPaths = [...kinds].flatMap(([g, k]) => {
    const p = k !== 'script' ? ctx.pathForGuid(g) : undefined
    return p && !/\.prefab$/i.test(p) ? [p] : []
  })
  const modelMetas = await ctx.readTexts(modelPaths.map((p) => `${p}.meta`))
  const all = [...scenes.values()]
  const materialGuids = [
    ...new Set([
      // Particle materials too, so their textures and shaders are exported with them.
      ...all.flatMap((s) => [...s.meshes.flatMap((m) => m.materials), ...s.instances.flatMap((i) => i.materials), ...s.particleMaterials]),
      ...modelPaths.flatMap((p) => parseFbxMeta(modelMetas.get(`${p}.meta`) ?? '').externalMaterials.map((m) => m.guid))
    ])
  ].filter((g) => g && !isBuiltin(g))
  const described = await describeMaterials(
    materialGuids.map((guid) => ({ guid })),
    ctx
  )
  described.files.forEach((f) => files.add(f))
  described.warnings.forEach((w) => warnings.add(w))

  // Whatever else is referenced: sprites and textures (indexed), then audio, animators, fonts….
  const known = new Set([...uses.keys(), ...materialGuids])
  const others = [...new Set(all.flatMap((s) => s.guids))].filter((g) => !known.has(g) && !isBuiltin(g))
  await ctx.prepare?.(others, 'texture')
  await ctx.prepare?.(
    others.filter((g) => !ctx.pathForGuid(g)),
    'other'
  )
  for (const g of others) if (ctx.pathForGuid(g)) uses.set(g, (uses.get(g) ?? 0) + 1)

  const guidPaths: Record<string, string> = {}
  const parts: PartRef[] = []
  const packageScripts: string[] = []
  for (const [guid, n] of uses) {
    const path = ctx.pathForGuid(guid)
    const k = kinds.get(guid)
    const kind: PartRef['kind'] = k === 'script' ? 'script' : k === 'model' ? 'model' : k === 'instance' ? (path && !/\.prefab$/i.test(path) ? 'model' : 'prefab') : 'other'
    const unsure = !path && (ctx.unsure?.(guid) ?? false)
    // Scripts and other assets not in the repo come from packages: nothing to carry, nothing to report.
    if (!path && (kind === 'script' || kind === 'other') && !unsure) {
      if (kind === 'script') packageScripts.push(guid)
      continue
    }
    if (path) {
      guidPaths[guid] = path
      addWithMeta(path)
    } else if (!unsure) warnings.add('missingModel')
    if (kind === 'script' && path) warnings.add('customScript')
    parts.push({ kind, guid, name: path ? baseName(path) : guid.slice(0, 8), path, missing: !path, unsure: unsure || undefined, size: path ? entrySize(ctx.byPath.get(path)) : undefined, uses: n })
  }
  for (const m of described.materials) if (m.guid && m.path) guidPaths[m.guid] = m.path
  parts.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.uses - a.uses || a.name.localeCompare(b.name))

  if (all.some((s) => s.particleSystems > 0)) warnings.add('particles')
  if (all.some((s) => s.uiElements > 0) && !all.some((s) => s.meshes.length) && !parts.some((p) => p.kind === 'model')) warnings.add('uiPrefab')

  const unsure = parts.some((p) => p.unsure) || described.materials.some((m) => m.unsure || m.textures.some((t) => t.unsure))
  return {
    kind: 'A',
    materials: described.materials,
    embeddedTextures: [],
    suggested: [],
    partial: unsure || undefined,
    warnings: [...warnings],
    files: [...files],
    parts,
    guidPaths,
    ...(particles.length ? { particles } : {}),
    ...(packageScripts.length ? { packageScripts } : {})
  }
}
