import { describe, expect, it } from 'vitest'
import { parseCatFileBatch } from './gitTree'

describe('parseCatFileBatch', () => {
  it('splits objects, including binary contents and missing ids', () => {
    const out = Buffer.concat([
      Buffer.from('aaa blob 5\nhello\n'),
      Buffer.from('bbb missing\n'),
      Buffer.from('ccc blob 3\n'),
      Buffer.from([0, 10, 255]),
      Buffer.from('\n')
    ])
    const objects = parseCatFileBatch(out)
    expect([...objects.keys()]).toEqual(['aaa', 'ccc'])
    expect(objects.get('aaa')!.toString()).toBe('hello')
    expect([...objects.get('ccc')!]).toEqual([0, 10, 255])
  })
})
