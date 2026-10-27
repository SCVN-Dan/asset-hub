import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import vi from './locales/vi.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
}

// Plural suffixes differ by language (Vietnamese only has `_other`), so compare base keys.
const base = (list: string[]) => new Set(list.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')))

describe('locales', () => {
  it('English and Vietnamese define the same keys', () => {
    expect([...base(keys(vi))].sort()).toEqual([...base(keys(en))].sort())
  })
})
