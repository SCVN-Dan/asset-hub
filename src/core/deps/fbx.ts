import { baseName, dirName } from '../registry'
import type { TreeEntry } from '../types'
import { BUILTIN_SHADER_GUIDS, extractFbxTextureNames, KNOWN_PACKAGE_SHADERS, parseFbxMeta, parseMaterial } from '../unity/yaml'
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
    return { name: parsed.name ?? m.name ?? baseName(path), guid: m.guid, path, missing: false, shader, textures }
  })
  return { materials, files: [...files], warnings: [...warnings] }
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

  return { kind, materials, embeddedTextures, warnings: [...warnings], files: [...files] }
}
