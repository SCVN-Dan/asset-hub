import { baseName, dirName } from '../registry'
import type { TreeEntry } from '../types'
import { parseAnimClip } from '../unity/animClip'
import { folderAffinity } from '../unity/prefab'
import type { DepContext } from './fbx'
import type { DependencyReport, PartRef } from './types'

const GUID = /guid: ([0-9a-f]{32})/g
const MAX_RIGS = 8
const entrySize = (e: TreeEntry | undefined) => (e ? (e.lfs ? (e.lfsSize ?? e.size) : e.size) : undefined)
const words = (p: string) => new Set(baseName(p).replace(/\.[^.]+$/, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))

/**
 * Models that may carry the rig a clip animates, most likely first. The
 * strongest hint is the clip's own name and folder ("Enemy/Goblin_Melee/
 * Skill1.anim" ↔ "FBXs/Enemy/Enemy_Goblin.fbx"); then folders shared with the
 * clip. Animation-only files (Model@Run.fbx, FBX under an Animation folder)
 * come after models.
 */
export function rigCandidates(animPath: string, ctx: Pick<DepContext, 'root' | 'byPath'>, limit = MAX_RIGS): string[] {
  const near = dirName(animPath).split('/')
  const split = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const ownWords = new Set([...words(animPath), ...split(baseName(dirName(animPath)))])
  const pathWords = new Set(split(dirName(animPath)))
  const scored: Array<{ path: string; score: number }> = []
  for (const path of ctx.byPath.keys()) {
    if (!/\.fbx$/i.test(path) || !path.startsWith(ctx.root + 'Assets/')) continue
    const parts = dirName(path).split('/')
    let shared = 0
    while (shared < near.length && shared < parts.length && near[shared] === parts[shared]) shared++
    const fileWords = [...words(path)]
    const named = fileWords.filter((w) => ownWords.has(w)).length * 15 + fileWords.filter((w) => !ownWords.has(w) && pathWords.has(w)).length * 3
    const animationOnly = baseName(path).includes('@') || /\/anim(ation)?s?\//i.test(path.slice(ctx.root.length))
    const score = shared * 4 + folderAffinity(path, animPath, ctx.root) * 3 + named - (animationOnly ? 8 : 0)
    scored.push({ path, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit)
    .map((s) => s.path)
}

/** A clip needs only what it references by GUID (sprites of a sprite animation, objects in events). */
export async function resolveAnimationDependencies(animPath: string, ctx: DepContext): Promise<DependencyReport> {
  const files = new Set([animPath])
  const warnings: DependencyReport['warnings'] = []
  if (ctx.byPath.has(`${animPath}.meta`)) files.add(`${animPath}.meta`)
  else warnings.push('noMeta')
  const text = (await ctx.readTexts([animPath])).get(animPath) ?? ''
  const guids = [...new Set([...text.matchAll(GUID)].map((m) => m[1]))].filter((g) => !/^0{16}/.test(g))
  await ctx.prepare?.(guids, 'texture')
  await ctx.prepare?.(
    guids.filter((g) => !ctx.pathForGuid(g)),
    'other'
  )
  const parts: PartRef[] = []
  for (const guid of guids) {
    const path = ctx.pathForGuid(guid)
    const unsure = !path && (ctx.unsure?.(guid) ?? false)
    if (!path && !unsure) continue
    if (path) {
      files.add(path)
      if (ctx.byPath.has(`${path}.meta`)) files.add(`${path}.meta`)
    }
    parts.push({ kind: 'other', guid, name: path ? baseName(path) : guid.slice(0, 8), path, missing: !path, unsure: unsure || undefined, size: path ? entrySize(ctx.byPath.get(path)) : undefined, uses: 1 })
  }
  // Only clips that move transforms need a rig to be seen.
  const info = parseAnimClip(text)
  const rigs = info.kind === 'generic' || info.kind === 'legacy' ? rigCandidates(animPath, ctx) : []
  return {
    kind: 'none',
    materials: [],
    embeddedTextures: [],
    suggested: [],
    partial: parts.some((p) => p.unsure) || undefined,
    warnings,
    files: [...files],
    parts,
    rigs
  }
}
