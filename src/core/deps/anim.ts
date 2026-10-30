import { baseName, dirName } from '../registry'
import type { TreeEntry } from '../types'
import { parseAnimClip } from '../unity/animClip'
import type { DepContext } from './fbx'
import type { DependencyReport, PartRef } from './types'

const GUID = /guid: ([0-9a-f]{32})/g
const MAX_RIGS = 8
const entrySize = (e: TreeEntry | undefined) => (e ? (e.lfs ? (e.lfsSize ?? e.size) : e.size) : undefined)

/** Folder names that say nothing about which character a clip is for. */
const GENERIC = new Set(['animation', 'animations', 'anim', 'anims', 'animator', 'animators', 'clip', 'clips', 'motion', 'motions', 'enemy', 'enemies', 'character', 'characters', 'model', 'models', 'fbx', 'fbxs', 'art', 'assets', 'prefab', 'prefabs', 'old', 'new', 'common', 'basic', 'controller', 'controllers', 'override'])

/** Words of a clip's name that say what it does, not who does it ("Customer_Idle": "idle"). */
const ACTIONS = new Set([
  'idle', 'run', 'running', 'walk', 'walking', 'jog', 'sprint', 'attack', 'atk', 'melee', 'skill', 'cast', 'spell', 'shoot', 'fire', 'aim', 'reload', 'throw',
  'hit', 'hurt', 'damage', 'die', 'dying', 'death', 'dead', 'stun', 'knockback', 'jump', 'fall', 'land', 'landing', 'spawn', 'appear', 'disappear', 'intro', 'outro',
  'pick', 'pickup', 'carry', 'stack', 'drop', 'push', 'pull', 'punch', 'kick', 'block', 'dodge', 'dash', 'roll', 'slide', 'climb', 'swim', 'fly', 'flying',
  'sit', 'sitting', 'stand', 'standing', 'talk', 'wave', 'dance', 'victory', 'win', 'lose', 'fail', 'cheer', 'celebrate', 'happy', 'sad', 'angry',
  'eat', 'eating', 'drink', 'sleep', 'work', 'working', 'cut', 'chop', 'dig', 'mine', 'move', 'turn', 'left', 'right', 'front', 'back', 'forward', 'backward',
  'start', 'end', 'loop', 'pose', 'tpose', 'action', 'emote', 'react', 'reaction', 'fast', 'slow', 'combo', 'charge', 'swing', 'slash', 'stab', 'catch', 'hold', 'open', 'close', 'upgrade'
])
/** Models named in the clip's own name, slipped in right after the best guess (the rig check then picks among them). */
const NAMED_EXTRA = 2
/** Animator controllers read to find the ones playing a clip, nearest first (a few KB each). */
const CONTROLLERS_READ = 24

/**
 * Models that may carry the rig a clip animates, most likely first, and only
 * related ones. The clip's folders name the character ("Enemy/Goblin_Melee/
 * Skill1.anim" ↔ "FBXs/Enemy/Enemy_Goblin.fbx"); its file name only names the
 * action ("Idle" would match every character's idle animation file). Models
 * sharing no character word with the clip are kept only from its own folder;
 * with none related at all, the closest few are offered. Animation-only files
 * (Model@Run.fbx, FBX under an Animation folder) come after models. When the
 * clip's name also names someone ("Customer_Idle" in a folder named after the
 * game), the models named so are tried right after the best guess. Animator
 * controllers that play the clip (`controllers`) say best whose it is
 * ("Customer.controller" plays "Stack_Idle"): models they name go first.
 */
export function rigCandidates(animPath: string, ctx: Pick<DepContext, 'root' | 'byPath'>, limit = MAX_RIGS, controllers: readonly string[] = []): string[] {
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
  const ranked = (related.length ? related : scored.slice(0, 3)).map((s) => s.path)
  const all = scored.map((s) => s.path)
  const clipWords = nameWords(baseName(animPath)).filter((w) => !ACTIONS.has(w) && !character.has(w))
  const byController = namedModels([...new Set(controllers.flatMap((c) => nameWords(baseName(c))))], all)
  const byName = namedModels(clipWords, all)
  return [...new Set([...byController.slice(0, NAMED_EXTRA), ...ranked.slice(0, 1), ...byName.slice(0, NAMED_EXTRA), ...ranked.slice(1)])].slice(0, limit)
}

/** Words of a file name that can name something ("Customer_Red.fbx": customer, red), digits and generic words left out. */
const nameWords = (file: string) =>
  file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/\d+$/, ''))
    .filter((w) => w.length > 2 && !GENERIC.has(w))

/**
 * Models whose file name has one of `named` ("customer" → "Customer_Red.fbx"),
 * most words first, then those whose name starts with one. Animation-only
 * files are left out.
 */
function namedModels(named: readonly string[], models: readonly string[]): string[] {
  if (!named.length) return []
  return models
    .filter((p) => !baseName(p).includes('@'))
    .map((p) => {
      const own = nameWords(baseName(p))
      return { p, hits: named.filter((w) => own.some((o) => o.includes(w))).length, starts: named.some((w) => own[0]?.startsWith(w)) }
    })
    .filter((m) => m.hits > 0)
    .sort((a, b) => b.hits - a.hits || Number(b.starts) - Number(a.starts) || a.p.length - b.p.length)
    .map((m) => m.p)
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
  const rigs = info.kind === 'generic' || info.kind === 'legacy' ? rigCandidates(animPath, ctx, MAX_RIGS, await controllersPlaying(animPath, ctx)) : []
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

/** Animator controllers (of the nearest few) whose states play this clip, found by its GUID. */
export async function controllersPlaying(animPath: string, ctx: Pick<DepContext, 'root' | 'byPath' | 'readTexts'>): Promise<string[]> {
  const meta = `${animPath}.meta`
  if (!ctx.byPath.has(meta)) return []
  const guid = /guid: ([0-9a-f]{32})/.exec((await ctx.readTexts([meta])).get(meta) ?? '')?.[1]
  if (!guid) return []
  const near = dirName(animPath).split('/')
  const closeness = (p: string) => {
    const parts = dirName(p).split('/')
    let shared = 0
    while (shared < near.length && shared < parts.length && near[shared] === parts[shared]) shared++
    return shared
  }
  const nearest = [...ctx.byPath.keys()]
    .filter((p) => /\.(controller|overrideController)$/i.test(p) && p.startsWith(ctx.root))
    .map((p) => ({ p, shared: closeness(p) }))
    .sort((a, b) => b.shared - a.shared || a.p.length - b.p.length)
    .slice(0, CONTROLLERS_READ)
    .map((c) => c.p)
  if (!nearest.length) return []
  const texts = await controllerTexts(ctx, nearest)
  return nearest.filter((p) => texts.get(p)?.includes(guid))
}

/** Controller texts already read, per commit (its file list): clips side by side ask for the same ones. */
const controllerCache = new WeakMap<object, Map<string, Promise<string>>>()

async function controllerTexts(ctx: Pick<DepContext, 'byPath' | 'readTexts'>, paths: readonly string[]): Promise<Map<string, string>> {
  let known = controllerCache.get(ctx.byPath)
  if (!known) controllerCache.set(ctx.byPath, (known = new Map()))
  const todo = paths.filter((p) => !known!.has(p))
  if (todo.length) {
    const read = ctx.readTexts(todo)
    // A failed read is not kept: the next clip tries again.
    for (const p of todo) known.set(p, read.then((t) => t.get(p) ?? '', () => (known!.delete(p), '')))
  }
  return new Map(await Promise.all(paths.map(async (p) => [p, await known!.get(p)!] as const)))
}
