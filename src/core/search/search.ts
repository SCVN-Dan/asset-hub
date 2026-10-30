import type { Asset } from '../types'
import { CONCEPTS, type Concept } from './concepts'

/** Lower case without diacritics, so "cá mập" and "ca map" are the same. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()
}

/** Words of a file or folder name: Fish_TunaA02.fbx → fish, tuna, a. */
export function nameWords(name: string): string[] {
  const base = name.replace(/\.[^./]+$/, '')
  const parts = base.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[a-z]+/g) ?? []
  return parts.map(normalize)
}

/** boxes → box, rocks → rock; leaves cactus, glass, axis alone. */
const singular = (w: string) =>
  w.length > 4 && /(x|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w

/** Edit distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

const typoBudget = (word: string) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0)

interface ConceptEntry {
  concept: Concept
  /** The group name as written, with diacritics ("cây"). */
  label: string
  /** Every word the concept stands for, groups inside it expanded. */
  words: Set<string>
}

function buildConcepts(): Map<string, ConceptEntry> {
  const byKey = new Map(CONCEPTS.map((c) => [c.key, c]))
  const expand = (key: string, seen: Set<string>): Set<string> => {
    const out = new Set([key])
    if (seen.has(key)) return out
    seen.add(key)
    const concept = byKey.get(key)
    for (const m of concept?.members ?? []) for (const w of expand(m, seen)) out.add(w)
    for (const a of concept?.aliases ?? []) if (!a.includes(' ')) out.add(normalize(a))
    return out
  }
  const byName = new Map<string, ConceptEntry>()
  for (const concept of CONCEPTS) {
    const words = expand(concept.key, new Set())
    for (const label of [concept.key, ...concept.aliases]) {
      const n = normalize(label)
      const existing = byName.get(n)
      // A word that names two groups ("stone") means both.
      byName.set(n, existing ? { ...existing, words: new Set([...existing.words, ...words]) } : { concept, label, words })
    }
  }
  return byName
}

const CONCEPT_INDEX = buildConcepts()
const LONGEST_ALIAS = Math.max(...[...CONCEPT_INDEX.keys()].map((k) => k.split(' ').length))

/** One thing the user asked for: a typed word, or a group name ("fish", "cá mập"). */
export interface QueryTerm {
  text: string
  /** Words a matching name may contain instead of `text` (empty when it names no group). */
  related: Set<string>
}

/** Splits a query into terms, joining words that together name a group ("ca map" → shark). */
export function parseQuery(query: string): QueryTerm[] {
  const words = normalize(query).split(/[\s_\-./]+/).filter(Boolean)
  const terms: QueryTerm[] = []
  for (let i = 0; i < words.length; ) {
    let taken = 0
    for (let n = Math.min(LONGEST_ALIAS, words.length - i); n >= 1 && !taken; n--) {
      const phrase = words.slice(i, i + n).join(' ')
      const concept = CONCEPT_INDEX.get(phrase) ?? CONCEPT_INDEX.get(singular(phrase))
      if (concept) {
        terms.push({ text: phrase, related: concept.words })
        taken = n
      }
    }
    if (!taken) {
      terms.push({ text: words[i], related: new Set() })
      taken = 1
    }
    i += taken
  }
  return terms
}

export type MatchKind = 'name' | 'related' | 'folder' | 'typo'

interface Indexed {
  asset: Asset
  name: string
  /** Other names the asset answers to (clips inside a model), normalised and joined. */
  extra: string
  words: string[]
  folders: string[]
}

export interface SearchResult {
  /** Matching assets, best first. */
  assets: Asset[]
  /** Group members that produced matches, e.g. ["shark", "tuna"] for "fish". */
  related: string[]
  /** Name words matched despite a typo, e.g. "wolf" for "wlof". */
  typos: string[]
  /** How well each asset (by id) matched: the name itself scores highest, then group members, folders, typos. */
  scores: ReadonlyMap<string, number>
}

export interface Suggestion {
  /** Text to put in the search box. */
  text: string
  /** How many assets it finds. */
  count: number
  /** For a group: a few of the names it covers. */
  examples?: string[]
}

const SCORE: Record<MatchKind, number> = { name: 100, related: 60, folder: 30, typo: 20 }

/** Search over asset names that understands groups (fish → shark), typos and folder names. */
export class AssetSearch {
  private readonly items: Indexed[]
  /** Every name word and how many assets use it, for suggestions. */
  private readonly vocabulary = new Map<string, number>()
  /** A name word as it appears in file names (before singular), for display. */
  private readonly spelling = new Map<string, string>()

  /** `extraNames`: other names an asset answers to, e.g. the animation clips inside a model. */
  constructor(assets: readonly Asset[], extraNames?: (asset: Asset) => readonly string[]) {
    this.items = assets.map((asset) => {
      const extras = extraNames?.(asset) ?? []
      const raw = [...nameWords(asset.name), ...extras.flatMap(nameWords)]
      const words = raw.map(singular)
      const folders = asset.path.split('/').slice(0, -1).flatMap(nameWords).map(singular)
      words.forEach((w, i) => this.spelling.has(w) || this.spelling.set(w, raw[i]))
      for (const w of new Set(words)) if (w.length > 1) this.vocabulary.set(w, (this.vocabulary.get(w) ?? 0) + 1)
      return { asset, name: normalize(asset.name), extra: extras.map(normalize).join(' '), words, folders }
    })
  }

  private matchTerm(item: Indexed, term: QueryTerm): { kind: MatchKind; word?: string } | undefined {
    // Short group names ("ca", "xe") would match inside unrelated names (Cactus); for them only the group counts.
    const literal = term.text.length >= 3 || !term.related.size
    if (literal && [item.name, item.extra].some((n) => n.includes(term.text) || n.includes(term.text.replace(/ /g, '')))) return { kind: 'name' }
    const related = item.words.find((w) => term.related.has(w))
    if (related) return { kind: 'related', word: related }
    if (item.folders.some((f) => f === singular(term.text) || term.related.has(f))) return { kind: 'folder' }
    const budget = typoBudget(term.text)
    if (budget && !term.related.size) {
      const word = item.words.find((w) => w.length >= 3 && editDistance(singular(term.text), w, budget) <= budget)
      if (word) return { kind: 'typo', word }
    }
    return undefined
  }

  /** Results by query: suggestions run many searches while the user types. */
  private readonly cache = new Map<string, SearchResult>()

  search(query: string): SearchResult {
    const key = normalize(query).trim()
    let result = this.cache.get(key)
    if (!result) {
      if (this.cache.size > 200) this.cache.clear()
      result = this.run(key)
      this.cache.set(key, result)
    }
    return result
  }

  private run(query: string): SearchResult {
    // "harvester | tractor | combine": any of the alternatives, each asset at its best match.
    const alternatives = query.split('|').map((q) => q.trim()).filter(Boolean)
    if (alternatives.length > 1) return this.any(alternatives)
    const terms = parseQuery(query)
    if (!terms.length) return { assets: this.items.map((i) => i.asset), related: [], typos: [], scores: new Map() }
    const related = new Map<string, number>()
    const typos = new Set<string>()
    const scored: Array<{ asset: Asset; score: number }> = []
    for (const item of this.items) {
      let score = 0
      const found: Array<{ kind: MatchKind; word?: string }> = []
      for (const term of terms) {
        const m = this.matchTerm(item, term)
        if (!m) {
          score = -1
          break
        }
        score += SCORE[m.kind]
        found.push(m)
      }
      if (score < 0) continue
      for (const m of found) {
        if (m.kind === 'related' && m.word) related.set(m.word, (related.get(m.word) ?? 0) + 1)
        if (m.kind === 'typo' && m.word) typos.add(m.word)
      }
      scored.push({ asset: item.asset, score })
    }
    scored.sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name))
    return {
      assets: scored.map((s) => s.asset),
      related: [...related].sort((a, b) => b[1] - a[1]).map(([w]) => w),
      typos: [...typos],
      scores: new Map(scored.map((s) => [s.asset.id, s.score]))
    }
  }

  private any(alternatives: readonly string[]): SearchResult {
    const best = new Map<string, { asset: Asset; score: number }>()
    const related = new Set<string>()
    const typos = new Set<string>()
    for (const alternative of alternatives) {
      const r = this.run(alternative)
      for (const asset of r.assets) {
        const score = r.scores.get(asset.id) ?? 0
        if ((best.get(asset.id)?.score ?? -1) < score) best.set(asset.id, { asset, score })
      }
      r.related.forEach((w) => related.add(w))
      r.typos.forEach((w) => typos.add(w))
    }
    const scored = [...best.values()].sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name))
    return { assets: scored.map((s) => s.asset), related: [...related], typos: [...typos], scores: new Map(scored.map((s) => [s.asset.id, s.score])) }
  }

  /**
   * The words the names are made of, as spelled in them, most used first; numbers and
   * one-letter parts left out. What the AI pet picks real search words from.
   */
  words(): Array<{ word: string; count: number }> {
    return [...this.vocabulary]
      .filter(([w]) => !/\d/.test(w))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([w, count]) => ({ word: this.spelling.get(w) ?? w, count }))
  }

  /** Keywords for the last word being typed: groups first, then words used in names. */
  suggest(query: string, limit = 8): Suggestion[] {
    const head = query.replace(/\S*$/, '')
    const last = normalize(query.slice(head.length))
    if (!last) return []
    const norm = normalize(query)
    const out: Suggestion[] = []
    const seen = new Set<string>()
    const add = (text: string, examples?: string[]) => {
      const full = head + text
      if (seen.has(normalize(full)) || normalize(full) === norm) return
      const count = this.search(full).assets.length
      if (!count) return
      seen.add(normalize(full))
      out.push({ text: full, count, examples })
    }
    const groups = [...CONCEPT_INDEX.entries()].filter(([name]) => name.startsWith(last))
    for (const [name, entry] of groups.sort((a, b) => a[0].length - b[0].length)) {
      const examples = [...this.vocabulary.keys()].filter((w) => entry.words.has(w) && w !== name).slice(0, 4)
      add(entry.label, examples.map((w) => this.spelling.get(w) ?? w))
    }
    const words = [...this.vocabulary].filter(([w]) => w.startsWith(last)).sort((a, b) => b[1] - a[1])
    for (const [w] of words) {
      if (out.length >= limit) break
      add(this.spelling.get(w) ?? w)
    }
    // Nothing starts with it: offer close spellings.
    if (!out.length && typoBudget(last)) {
      const close = [...this.vocabulary].filter(([w]) => editDistance(last, w, typoBudget(last)) <= typoBudget(last)).sort((a, b) => b[1] - a[1])
      for (const [w] of close.slice(0, limit)) add(this.spelling.get(w) ?? w)
    }
    return out.slice(0, limit)
  }
}
