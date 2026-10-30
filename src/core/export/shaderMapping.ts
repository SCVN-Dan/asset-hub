// Shader Mapping (PLAN §6b, case 4): materials of the package switched to a
// shader of the target project when exported, property names carried over —
// no Unity needed. The rules live in the target project, in
// `.assethub/shader-mapping.json`, so the whole team shares them through Git:
//
//   { "mappings": [ { "from": "Custom/Toon", "to": "Universal Render Pipeline/Lit",
//                     "props": { "_MainTex": "_BaseMap", "_Color": "_BaseColor" } } ] }
//
// "from" is a shader name, a shader GUID, or "builtin:<fileID>" for Unity's
// built-in shaders (e.g. "builtin:46" = Standard); "to" is a shader name or GUID.

import type { ProjectShader } from './target'

export const SHADER_MAPPING_FILE = '.assethub/shader-mapping.json'

export interface ShaderRule {
  from: string
  to: string
  props: Record<string, string>
}

/** A shader as a material points at it. */
export interface ShaderRef {
  fileID: string
  guid: string
  type: string
}

/** Unity's built-in shaders all live in one resource, told apart by file ID. */
export const BUILTIN_GUID = '0000000000000000f000000000000000'

/** The file ID a shader asset has inside its file. */
export const SHADER_FILE_ID = { shader: '4800000', shadergraph: '-6465566751694194690' } as const

/** Rules from the mapping file; anything malformed is reported, not guessed. */
export function parseShaderMapping(text: string): { rules: ShaderRule[]; errors: string[] } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { rules: [], errors: [`${SHADER_MAPPING_FILE}: ${(e as Error).message}`] }
  }
  const list = (json as { mappings?: unknown })?.mappings
  if (!Array.isArray(list)) return { rules: [], errors: [`${SHADER_MAPPING_FILE}: "mappings" must be a list`] }
  const rules: ShaderRule[] = []
  const errors: string[] = []
  list.forEach((m: { from?: unknown; to?: unknown; props?: unknown }, i) => {
    const props = m?.props ?? {}
    const okProps = typeof props === 'object' && !Array.isArray(props) && Object.values(props as object).every((v) => typeof v === 'string')
    if (typeof m?.from !== 'string' || !m.from || typeof m?.to !== 'string' || !m.to || !okProps) errors.push(`${SHADER_MAPPING_FILE}: mapping #${i + 1} needs "from", "to" and string "props"`)
    else rules.push({ from: m.from, to: m.to, props: props as Record<string, string> })
  })
  return { rules, errors }
}

const SHADER_LINE = /^(\s*m_Shader: )\{fileID: (-?\d+), guid: ([0-9a-f]{32}), type: (\d+)\}/m

/** The shader a material uses. */
export function materialShader(text: string): ShaderRef | undefined {
  const m = SHADER_LINE.exec(text)
  return m ? { fileID: m[2], guid: m[3], type: m[4] } : undefined
}

/** Whether a rule's "from" names this shader (`name` when known). */
export function ruleMatches(rule: ShaderRule, shader: ShaderRef, name: string | undefined): boolean {
  if (rule.from.startsWith('builtin:')) return shader.guid === BUILTIN_GUID && shader.fileID === rule.from.slice('builtin:'.length)
  return rule.from === shader.guid || rule.from === name
}

const SECTION = /^\s*m_(TexEnvs|Ints|Floats|Colors):/
const ENTRY = /^(\s*)- ([^:\s]+):/

/**
 * A material switched to another shader: the m_Shader reference, and saved
 * properties renamed per the rule. A renamed property replaces one already
 * saved under the new name (Unity keeps values of properties a shader no
 * longer has, so a material often holds both).
 */
export function mapMaterial(text: string, to: ShaderRef, props: Record<string, string>): string {
  const lines = text.replace(SHADER_LINE, `$1{fileID: ${to.fileID}, guid: ${to.guid}, type: ${to.type}}`).split('\n')
  // Saved properties, as line ranges per section.
  const entries: Array<{ section: string; name: string; start: number; end: number }> = []
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const s = SECTION.exec(lines[i])
    if (s) {
      section = s[1]
      continue
    }
    const e = section && ENTRY.exec(lines[i])
    if (!e) continue
    let end = i + 1
    while (end < lines.length && lines[end].trim() && indent(lines[end]) > e[1].length) end++
    entries.push({ section, name: e[2], start: i, end })
    i = end - 1
  }
  const drop = new Set<number>()
  for (const e of entries) {
    const rename = props[e.name]
    if (!rename || rename === e.name) continue
    const movesAway = (name: string) => props[name] !== undefined && props[name] !== name
    for (const taken of entries) if (taken.section === e.section && taken.name === rename && !movesAway(taken.name)) for (let i = taken.start; i < taken.end; i++) drop.add(i)
    lines[e.start] = lines[e.start].replace(ENTRY, `$1- ${rename}:`)
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n')
}

/**
 * Applies the rules to materials: each "to" resolved among the project's
 * shaders (by name or GUID), each material's shader named from the package's
 * and the project's shaders. A rule whose "to" the project lacks is reported
 * and skipped.
 */
export function shaderMapper(
  rules: readonly ShaderRule[],
  projectShaders: ReadonlyMap<string, ProjectShader>,
  packageNames: ReadonlyMap<string, string>
): { errors: string[]; map: (text: string) => { text: string; from: string; to: string } | undefined } {
  const nameOf = new Map([...projectShaders].map(([name, s]) => [s.guid, name]))
  for (const [guid, name] of packageNames) nameOf.set(guid, name)
  const errors: string[] = []
  const resolved = rules.flatMap((rule) => {
    const named = projectShaders.get(rule.to) ?? [...projectShaders.values()].find((s) => s.guid === rule.to)
    if (!named) {
      errors.push(`${SHADER_MAPPING_FILE}: "${rule.to}" is not a shader of the project`)
      return []
    }
    return [{ rule, to: { fileID: SHADER_FILE_ID[named.kind], guid: named.guid, type: '3' }, toName: nameOf.get(named.guid) ?? rule.to }]
  })
  const map = (text: string) => {
    const shader = materialShader(text)
    if (!shader) return undefined
    const name = nameOf.get(shader.guid)
    const hit = resolved.find((r) => ruleMatches(r.rule, shader, name))
    if (!hit || hit.to.guid === shader.guid) return undefined
    return { text: mapMaterial(text, hit.to, hit.rule.props), from: name ?? hit.rule.from, to: hit.toName }
  }
  return { errors, map }
}

const indent = (line: string) => line.length - line.trimStart().length
