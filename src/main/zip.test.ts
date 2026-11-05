import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { zipFiles } from './zip'

const dir = mkdtempSync(join(tmpdir(), 'zip-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('zipFiles', () => {
  it('unzips with the system tools, contents and dates intact', () => {
    const when = new Date(2026, 10, 5, 14, 30, 20)
    const text = new TextEncoder().encode('xin chào '.repeat(200))
    writeFileSync(join(dir, 'a.zip'), zipFiles([{ name: 'Tên có dấu.txt', data: text }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }], when))
    execFileSync('ditto', ['-x', '-k', join(dir, 'a.zip'), join(dir, 'out')])
    expect(readFileSync(join(dir, 'out', 'Tên có dấu.txt'))).toEqual(Buffer.from(text))
    expect([...readFileSync(join(dir, 'out', 'b.bin'))]).toEqual([1, 2, 3])
    expect(statSync(join(dir, 'out', 'b.bin')).mtime.getTime()).toBe(when.getTime())
  })
})
