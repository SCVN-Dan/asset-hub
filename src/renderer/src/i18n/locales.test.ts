import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import vi from './locales/vi.json'
import ko from './locales/ko.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
}

// Plural suffixes differ by language (Vietnamese and Korean only have `_other`), so compare base keys.
const base = (list: string[]) => new Set(list.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')))

describe('locales', () => {
  it.each([
    ['Vietnamese', vi],
    ['Korean', ko]
  ])('%s defines the same keys as English', (_, locale) => {
    expect([...base(keys(locale))].sort()).toEqual([...base(keys(en))].sort())
  })
})
