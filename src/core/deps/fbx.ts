import { baseName, dirName } from '../registry'
import type { TreeEntry } from '../types'
import { BUILTIN_SHADER_GUIDS, extractFbxTextureNames, KNOWN_PACKAGE_SHADERS, metaGuid, parseFbxMeta, parseMaterial } from '../unity/yaml'
import type { DependencyReport, DependencyWarning, MaterialRef, ShaderRef, TextureRef } from './types'

/** What a resolver may ask of the branch it is resolving in. All paths are repo paths. */
export interface DepContext {
  /** Unity project root prefix, e.g. 'unity_project/game/' or ''. */
  root: string
  byPath: ReadonlyMap<string, TreeEntry>
  pathForGuid(guid: string): string | undefined
  /** Repo paths of files with this name (case-insensitive). */
  pathsByName(name: string): readonly string[]
  readTexts(paths: readonly string[]): Promise<Map<string, string>>
  readBytes(path: string): Promise<Uint8Array>
}

const MAX_SUGGESTED = 8

const entrySize = (e: TreeEntry | undefined) => (e ? (e.lfs ? (e.lfsSize ?? e.size) : e.size) : undefined)

/** Picks the candidate closest to `nearPath` (longest shared folder prefix). */
export function closestPath(candidates: readonly string[], nearPath: string): string | undefined {
  const near = dirName(nearPath).split('/')
  let best: string | undefined
  let bestScore = -1
  for (const c of candidates) {
    const parts = dirName(c).split('/')
    let score = 0
    while (score < near.length && score < parts.length && near[score] === parts[score]) score++
    if (score > bestScore || (score === bestScore && best && c.length < best.length)) {
      best = c
      bestScore = score
    }
  }
  return best
}

function classifyShader(guid: string, ctx: DepContext): ShaderRef {
  if (BUILTIN_SHADER_GUIDS.has(guid)) return { guid, kind: 'builtin', label: 'Built-in' }
  const path = ctx.pathForGuid(guid)
  if (path) return { guid, kind: 'project', label: baseName(path), path }
  return { guid, kind: 'package', label: KNOWN_PACKAGE_SHADERS[guid] ?? `Package shader (${guid.slice(0, 8)})` }
}

/**
 * Materials by GUID → their .mat file, shader and textures, plus every file
 * (with .meta) an export needs. Used for an FBX's own materials and for
 * materials found on prefabs that use it.
 */
export async function describeMaterials(
  refs: ReadonlyArray<{ name?: string; guid: string }>,
  ctx: DepContext
): Promise<{ materials: MaterialRef[]; files: string[]; warnings: DependencyWarning[] }> {
  const warnings = new Set<DependencyWarning>()
  const files = new Set<string>()
  const addWithMeta = (p: string) => {
    files.add(p)
    if (ctx.byPath.has(`${p}.meta`)) files.add(`${p}.meta`)
  }
  const matPaths = new Map<string, string>()
  for (const m of refs) {
    const p = ctx.pathForGuid(m.guid)
    if (p) matPaths.set(m.guid, p)
  }
  const matTexts = await ctx.readTexts([...new Set(matPaths.values())])
  const shaderFiles: string[] = []
  const parents: string[] = []
  const materials: MaterialRef[] = refs.map((m) => {
    const path = matPaths.get(m.guid)
    if (!path) {
      warnings.add('missingMaterial')
      return { name: m.name ?? m.guid.slice(0, 8), guid: m.guid, missing: true, textures: [] }
    }
    addWithMeta(path)
    const parsed = parseMaterial(matTexts.get(path) ?? '')
    const shader = parsed.shader ? classifyShader(parsed.shader.guid, ctx) : undefined
    if (shader?.kind === 'project') {
      warnings.add('customShader')
      addWithMeta(shader.path!)
      shaderFiles.push(shader.path!)
    }
    // A Material Variant needs its parent material to import correctly.
    if (parsed.parentGuid) {
      const parent = ctx.pathForGuid(parsed.parentGuid)
      if (parent) {
        addWithMeta(parent)
        parents.push(parent)
      }
    }
    const textures: TextureRef[] = parsed.textures.map((t) => {
      const tp = ctx.pathForGuid(t.guid)
      if (!tp) {
        warnings.add('missingTexture')
        return { prop: t.prop, guid: t.guid, name: t.prop, matchedBy: 'guid', missing: true }
      }
      addWithMeta(tp)
      return { prop: t.prop, guid: t.guid, path: tp, name: baseName(tp), matchedBy: 'guid', missing: false, size: entrySize(ctx.byPath.get(tp)) }
    })
    return { name: parsed.name ?? m.name ?? baseName(path), sourceName: m.name, guid: m.guid, path, missing: false, shader, textures }
  })
  // Parents of variants bring their own textures and shaders.
  if (parents.length) {
    const parentTexts = await ctx.readTexts(parents)
    for (const p of parents) {
      const parsed = parseMaterial(parentTexts.get(p) ?? '')
      for (const t of parsed.textures) {
        const tp = ctx.pathForGuid(t.guid)
        if (tp) addWithMeta(tp)
      }
      const sp = parsed.shader && ctx.pathForGuid(parsed.shader.guid)
      if (sp) {
        addWithMeta(sp)
        shaderFiles.push(sp)
      }
    }
  }
  for (const f of await shaderDependencies(shaderFiles, ctx)) addWithMeta(f)
  return { materials, files: [...files], warnings: [...warnings] }
}

/**
 * Files a project shader needs to compile: #include'd .hlsl/.cginc (relative
 * to the shader or to the project) and, for Shader Graphs, every asset they
 * reference by GUID (sub-graphs, textures). Followed a few levels deep.
 */
async function shaderDependencies(start: readonly string[], ctx: DepContext): Promise<string[]> {
  const seen = new Set<string>(start)
  const found: string[] = []
  let frontier = [...seen]
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const texts = await ctx.readTexts(frontier)
    const next: string[] = []
    for (const file of frontier) {
      const text = texts.get(file) ?? ''
      const refs = new Set<string>()
      for (const m of text.matchAll(/#include\s+"([^"]+)"/g)) {
        const inc = m[1].replace(/\\/g, '/')
        const candidates = [`${dirName(file)}/${inc}`, `${ctx.root}${inc}`].map(normalisePath)
        const hit = candidates.find((c) => ctx.byPath.has(c))
        if (hit) refs.add(hit)
      }
      if (/\.shader(sub)?graph$/i.test(file)) {
        for (const m of text.matchAll(/"guid"\s*:\s*"([0-9a-f]{32})"/g)) {
          const p = ctx.pathForGuid(m[1])
          if (p) refs.add(p)
        }
      }
      for (const r of refs) {
        if (seen.has(r)) continue
        seen.add(r)
        found.push(r)
        if (/\.(hlsl|cginc|shader|shadersubgraph|shadergraph)$/i.test(r)) next.push(r)
      }
    }
    frontier = next
  }
  return found
}

/** Resolves "." and ".." segments. */
function normalisePath(p: string): string {
  const out: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return out.join('/')
}

/**
 * FBX dependencies: kind A follows GUIDs from the .meta's externalObjects to
 * .mat files, then to their shader and textures. Kind B (embedded materials)
 * has no GUIDs, so texture file names found inside the FBX are matched to
 * files in the project by name, nearest folder first.
 */
export async function resolveFbxDependencies(fbxPath: string, ctx: DepContext): Promise<DependencyReport> {
  const warnings = new Set<DependencyWarning>()
  const files = new Set<string>([fbxPath])
  const addWithMeta = (p: string) => {
    files.add(p)
    if (ctx.byPath.has(`${p}.meta`)) files.add(`${p}.meta`)
  }

  const metaPath = `${fbxPath}.meta`
  const metaText = (await ctx.readTexts([metaPath])).get(metaPath)
  if (!metaText) warnings.add('noMeta')
  else files.add(metaPath)
  const info = parseFbxMeta(metaText ?? '')

  const kind: DependencyReport['kind'] = info.externalMaterials.length ? 'A' : info.materialImportMode === 0 ? 'none' : 'B'
  if (kind === 'none') warnings.add('noMaterials')

  // Kind A: .mat files by GUID.
  const described = await describeMaterials(info.externalMaterials, ctx)
  described.files.forEach((f) => files.add(f))
  described.warnings.forEach((w) => warnings.add(w))
  const materials = described.materials

  // Kind B: texture names written inside the FBX.
  const embeddedTextures: TextureRef[] = []
  if (kind === 'B') {
    const names = extractFbxTextureNames(await ctx.readBytes(fbxPath))
    for (const name of names) {
      const candidates = ctx.pathsByName(name).filter((p) => p.startsWith(ctx.root + 'Assets/'))
      const path = closestPath(candidates, fbxPath)
      if (!path) {
        warnings.add('missingTexture')
        embeddedTextures.push({ name, matchedBy: 'name', missing: true })
        continue
      }
      warnings.add('textureByName')
      addWithMeta(path)
      embeddedTextures.push({ name, path, matchedBy: 'name', missing: false, size: entrySize(ctx.byPath.get(path)) })
    }
  }

  // No materials of its own: offer .mat files placed next to it (same folder or a Materials/ folder beside it).
  const suggested: DependencyReport['suggested'] = []
  if (!materials.length) {
    const dir = dirName(fbxPath)
    const parent = dirName(dir)
    const near = [...ctx.byPath.keys()].filter((p) => {
      if (!p.endsWith('.mat')) return false
      const d = dirName(p)
      return d === dir || d === `${dir}/Materials` || d === `${parent}/Materials`
    })
    const metas = await ctx.readTexts(near.slice(0, MAX_SUGGESTED).map((p) => `${p}.meta`))
    for (const p of near.slice(0, MAX_SUGGESTED)) {
      const guid = metaGuid(metas.get(`${p}.meta`) ?? '')
      if (!guid) continue
      const d = await describeMaterials([{ guid, name: baseName(p).replace(/\.mat$/, '') }], { ...ctx, pathForGuid: (g) => (g === guid ? p : ctx.pathForGuid(g)) })
      if (d.materials[0] && !d.materials[0].missing) suggested.push({ material: d.materials[0], files: d.files })
    }
  }

  return { kind, materials, embeddedTextures, suggested, warnings: [...warnings], files: [...files] }
}
