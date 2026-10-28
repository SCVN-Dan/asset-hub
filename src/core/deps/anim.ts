import { baseName, dirName } from '../registry'
import type { TreeEntry } from '../types'
import { parseAnimClip } from '../unity/animClip'
import type { DepContext } from './fbx'
import type { DependencyReport, PartRef } from './types'

const GUID = /guid: ([0-9a-f]{32})/g
const MAX_RIGS = 8
const entrySize = (e: TreeEntry | undefined) => (e ? (e.lfs ? (e.lfsSize ?? e.size) : e.size) : undefined)

/** Folder names that say nothing about which character a clip is for. */
const GENERIC = new Set(['animation', 'animations', 'anim', 'anims', 'animator', 'animators', 'clip', 'clips', 'motion', 'motions', 'enemy', 'enemies', 'character', 'characters', 'model', 'models', 'fbx', 'fbxs', 'art', 'assets', 'prefab', 'prefabs', 'old', 'new', 'common', 'basic'])

/**
 * Models that may carry the rig a clip animates, most likely first, and only
 * related ones. The clip's folders name the character ("Enemy/Goblin_Melee/
 * Skill1.anim" ↔ "FBXs/Enemy/Enemy_Goblin.fbx"); its file name only names the
 * action ("Idle" would match every character's idle animation file). Models
 * sharing no character word with the clip are kept only from its own folder;
 * with none related at all, the closest few are offered. Animation-only files
 * (Model@Run.fbx, FBX under an Animation folder) come after models.
 */
export function rigCandidates(animPath: string, ctx: Pick<DepContext, 'root' | 'byPath'>, limit = MAX_RIGS): string[] {
  const split = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w))
  const folders = dirName(animPath).slice(ctx.root.length).split('/')
  // The clip's folder and the one above it ("Player/WeaponAnims", "Enemy/Goblin_Melee").
  const character = new Set(folders.slice(-2).flatMap(split))
  const action = new Set(split(baseName(animPath).replace(/\.[^.]+$/, '')))
  const near = dirName(animPath).split('/')
  const scored: Array<{ path: string; score: number; related: boolean }> = []
  for (const path of ctx.byPath.keys()) {
    if (!/\.fbx$/i.test(path) || !path.startsWith(ctx.root + 'Assets/')) continue
    const parts = dirName(path).split('/')
    let shared = 0
    while (shared < near.length && shared < parts.length && near[shared] === parts[shared]) shared++
    // Words of the model's name and its own folder ("Characters/Goblin/Model.fbx").
    const own = new Set([...split(baseName(path).replace(/\.[^.]+$/, '')), ...split(baseName(dirName(path)))])
    // "Frog" names "Frogking"; but "WeaponAnims" does not name every weapon: only a model word may contain the clip's.
    const characterHits = [...character].filter((w) => own.has(w) || [...own].some((o) => o.includes(w))).length
    const actionHits = [...action].filter((w) => own.has(w)).length
    const animationOnly = baseName(path).includes('@') || /\/anim(ation)?s?\//i.test(path.slice(ctx.root.length))
    const sameFolder = dirName(path) === dirName(animPath)
    const score = characterHits * 15 + actionHits * 2 + shared * 2 + (sameFolder ? 10 : 0) - (animationOnly ? 8 : 0)
    scored.push({ path, score, related: characterHits > 0 || sameFolder })
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  const related = scored.filter((s) => s.related)
  return (related.length ? related : scored.slice(0, 3)).slice(0, limit).map((s) => s.path)
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
