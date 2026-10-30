// FileIDs of the objects Unity makes when it imports a model. Since Unity
// 2019.3 the .meta no longer lists them (internalIDToNameTable stays empty):
// each is derived from the object's type and name, as the signed 64-bit
// xxHash64 of "Type:<Type>-><Name><index>" — index counting objects of that
// type and name, from 0.

const MASK = (1n << 64n) - 1n
const P1 = 11400714785074694791n
const P2 = 14029467366897019727n
const P3 = 1609587929392839161n
const P4 = 9650029242287828579n
const P5 = 2870177450012600261n

const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & MASK
const round = (acc: bigint, input: bigint) => (rotl((acc + input * P2) & MASK, 31n) * P1) & MASK
const merge = (acc: bigint, v: bigint) => (((acc ^ round(0n, v)) * P1 + P4) & MASK)

/** xxHash64, seed 0. */
export function xxHash64(data: Uint8Array): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const n = data.length
  const u64 = (i: number) => view.getBigUint64(i, true)
  let i = 0
  let h: bigint
  if (n >= 32) {
    let v1 = (P1 + P2) & MASK
    let v2 = P2
    let v3 = 0n
    let v4 = (MASK + 1n - P1) & MASK
    for (; i + 32 <= n; i += 32) {
      v1 = round(v1, u64(i))
      v2 = round(v2, u64(i + 8))
      v3 = round(v3, u64(i + 16))
      v4 = round(v4, u64(i + 24))
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK
    for (const v of [v1, v2, v3, v4]) h = merge(h, v)
  } else h = P5
  h = (h + BigInt(n)) & MASK
  for (; i + 8 <= n; i += 8) h = (rotl(h ^ round(0n, u64(i)), 27n) * P1 + P4) & MASK
  if (i + 4 <= n) {
    h = (rotl(h ^ ((BigInt(view.getUint32(i, true)) * P1) & MASK), 23n) * P2 + P3) & MASK
    i += 4
  }
  for (; i < n; i++) h = (rotl(h ^ ((BigInt(data[i]) * P5) & MASK), 11n) * P1) & MASK
  h ^= h >> 33n
  h = (h * P2) & MASK
  h ^= h >> 29n
  h = (h * P3) & MASK
  h ^= h >> 32n
  return h
}

/** The fileID Unity gives an imported object (a model's mesh: type "Mesh"), as the .prefab writes it. */
export function importedObjectId(type: string, name: string, index = 0): string {
  return BigInt.asIntN(64, xxHash64(new TextEncoder().encode(`Type:${type}->${name}${index}`))).toString()
}

/**
 * Which of a model's meshes (by name, in file order) a mesh fileID stands
 * for; repeated names count up their index.
 */
export function meshForFileId(names: readonly string[], fileID: string): number {
  const seen = new Map<string, number>()
  for (const [i, name] of names.entries()) {
    const index = seen.get(name) ?? 0
    seen.set(name, index + 1)
    if (importedObjectId('Mesh', name, index) === fileID) return i
  }
  return -1
}
