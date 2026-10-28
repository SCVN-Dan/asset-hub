// Unity AnimationClip (.anim) files: their curves, read from YAML, and
// sampled the way Unity evaluates them (cubic Hermite between keys).

const GUID = '[0-9a-f]{32}'

/** One key; `v`, `inS` and `outS` have one number per component (3 for positions, 4 for rotations, 1 for floats). */
export interface CurveKey {
  t: number
  v: number[]
  inS: number[]
  outS: number[]
}

export interface TransformCurve {
  /** Transform path from the animated root, "" for the root itself. */
  path: string
  kind: 'position' | 'rotation' | 'euler' | 'scale'
  keys: CurveKey[]
}

export interface FloatCurve {
  path: string
  attribute: string
  /** Component class the property belongs to (4 Transform, 224 RectTransform, 95 Animator…). */
  classID: number
  keys: CurveKey[]
}

export type ClipKind = 'generic' | 'humanoid' | 'legacy' | 'ui' | 'sprite' | 'property'

export interface AnimClipInfo {
  name: string
  /** Seconds. */
  length: number
  sampleRate: number
  loop: boolean
  legacy: boolean
  /** Compressed curves are not stored as keys: nothing to preview. */
  compressed: boolean
  kind: ClipKind
  transformCurves: TransformCurve[]
  floatCurves: FloatCurve[]
  spriteCurves: number
  /** Sprites a sprite animation switches between. */
  spriteGuids: string[]
  events: number
  /** Distinct objects animated. */
  paths: string[]
  keyframes: number
}

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s))

/** "{x: 1, y: 2, z: 3}" → [1, 2, 3]; a plain number → [n]. Infinity is a step tangent. */
function values(raw: string, size: number): number[] {
  const t = raw.trim()
  if (!t.startsWith('{')) return [num(t)]
  return ['x', 'y', 'z', 'w'].slice(0, size).map((k) => num(new RegExp(`\\b${k}: (-?[\\w.+-]+)`).exec(t)?.[1]))
}

/** Items of a top-level list (two-space key, "- " entries at two spaces), read line by line: clips can be megabytes. */
function listItems(text: string, key: string): string[] {
  const start = text.indexOf(`\n  ${key}:\n`)
  if (start === -1) return []
  const lines = text.slice(start + key.length + 5).split('\n')
  const items: string[] = []
  let current: string[] | undefined
  for (const line of lines) {
    if (line.startsWith('  - ')) {
      if (current) items.push(current.join('\n'))
      current = [line.slice(4)]
    } else if (line.startsWith('    ') && current) current.push(line)
    else break
  }
  if (current) items.push(current.join('\n'))
  return items
}

function parseKeys(item: string, size: number): CurveKey[] {
  const keys: CurveKey[] = []
  for (const k of item.split(/^\s*- serializedVersion: \d+\n/m).slice(1)) {
    const field = (name: string) => new RegExp(`^\\s*${name}: (.*)$`, 'm').exec(k)?.[1]
    const t = num(field('time'))
    if (!Number.isFinite(t)) continue
    const v = values(field('value') ?? '', size)
    keys.push({ t, v, inS: values(field('inSlope') ?? '0', size), outS: values(field('outSlope') ?? '0', size) })
  }
  return keys
}

const MUSCLE = /^(Root[TQ]\.|Motion[TQ]\.|Left|Right|Spine |Chest |UpperChest |Neck |Head |Jaw |Left Eye|Right Eye)/

export function parseAnimClip(animText: string): AnimClipInfo {
  const text = animText.replace(/\r\n/g, '\n')
  const field = (name: string) => new RegExp(`^ {2}${name}: (.*)$`, 'm').exec(text)?.[1]?.trim()
  const settings = /^ {2}m_AnimationClipSettings:\n((?: {4}.*\n?)*)/m.exec(text)?.[1] ?? ''
  const setting = (name: string) => new RegExp(`^ {4}${name}: (.*)$`, 'm').exec(settings)?.[1]?.trim()

  const transformCurves: TransformCurve[] = []
  for (const [key, kind, size] of [
    ['m_PositionCurves', 'position', 3],
    ['m_RotationCurves', 'rotation', 4],
    ['m_EulerCurves', 'euler', 3],
    ['m_ScaleCurves', 'scale', 3]
  ] as const) {
    for (const item of listItems(text, key)) {
      const keys = parseKeys(item, size)
      if (keys.length) transformCurves.push({ path: /^ {4}path: (.*)$/m.exec(item)?.[1]?.trim() ?? '', kind, keys })
    }
  }
  const floatCurves: FloatCurve[] = listItems(text, 'm_FloatCurves').map((item) => ({
    path: /^ {4}path: (.*)$/m.exec(item)?.[1]?.trim() ?? '',
    attribute: /^ {4}attribute: (.*)$/m.exec(item)?.[1]?.trim() ?? '',
    classID: num(/^ {4}classID: (\d+)/m.exec(item)?.[1]),
    keys: parseKeys(item, 1)
  }))
  const pptr = listItems(text, 'm_PPtrCurves')
  const spriteGuids = [...new Set(pptr.flatMap((item) => [...item.matchAll(new RegExp(`value: \\{fileID: -?\\d+, guid: (${GUID})`, 'g'))].map((m) => m[1])))]

  const start = num(setting('m_StartTime'))
  const stop = num(setting('m_StopTime'))
  const lastKey = Math.max(0, ...transformCurves.flatMap((c) => c.keys.map((k) => k.t)), ...floatCurves.flatMap((c) => c.keys.map((k) => k.t)))
  const legacy = field('m_Legacy') === '1'
  const humanoid = floatCurves.some((c) => c.classID === 95 && MUSCLE.test(c.attribute))
  const kind: ClipKind = humanoid
    ? 'humanoid'
    : legacy
      ? 'legacy'
      : floatCurves.some((c) => c.classID === 224)
        ? 'ui'
        : transformCurves.length
        ? 'generic'
        : pptr.length
          ? 'sprite'
          : 'property'
  return {
    name: field('m_Name') ?? '',
    length: Number.isFinite(stop) ? Math.max(0, stop - (Number.isFinite(start) ? start : 0)) : lastKey,
    sampleRate: num(field('m_SampleRate')) || 60,
    loop: setting('m_LoopTime') === '1',
    legacy,
    compressed: field('m_Compressed') === '1',
    kind,
    transformCurves,
    floatCurves,
    spriteCurves: pptr.length,
    spriteGuids,
    events: listItems(text, 'm_Events').length,
    paths: [...new Set([...transformCurves.map((c) => c.path), ...floatCurves.map((c) => c.path)])],
    keyframes: transformCurves.reduce((s, c) => s + c.keys.length, 0) + floatCurves.reduce((s, c) => s + c.keys.length, 0)
  }
}

/** Value of a curve at time `t`: cubic Hermite between keys, held before the first and after the last; infinite tangents step. */
export function sampleCurve(keys: readonly CurveKey[], t: number): number[] {
  if (!keys.length) return []
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const dt = b.t - a.t
  if (dt <= 0) return b.v
  const s = (t - a.t) / dt
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return a.v.map((av, c) => {
    const m0 = a.outS[c]
    const m1 = b.inS[c]
    if (!Number.isFinite(m0) || !Number.isFinite(m1)) return av
    return h00 * av + h10 * dt * m0 + h01 * b.v[c] + h11 * dt * m1
  })
}
