import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { SettingsStore } from './settingsStore'

const dir = mkdtempSync(join(tmpdir(), 'settings-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const defaults = { language: 'en' as const, cacheDir: '/c', excludedFolders: [] }

describe('SettingsStore', () => {
  it('keeps what another version of the app saved when saving its own', () => {
    const file = join(dir, 'a.json')
    writeFileSync(file, JSON.stringify({ language: 'vi', cacheDir: '/c', excludedFolders: [], futureThing: { on: true } }))
    const store = new SettingsStore(file, defaults)
    store.set({ usageStats: false })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ language: 'vi', usageStats: false, futureThing: { on: true } })
  })

  it('also keeps what the other copy saved after this one started', () => {
    const file = join(dir, 'b.json')
    writeFileSync(file, JSON.stringify({ language: 'en', cacheDir: '/c', excludedFolders: [] }))
    const store = new SettingsStore(file, defaults)
    // The newer copy, running alongside, turns on something this one does not know.
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), laterSetting: true }))
    store.set({ lastRepo: 'o/r' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ lastRepo: 'o/r', laterSetting: true })
  })

  it('still drops invalid values of the settings it knows', () => {
    const file = join(dir, 'c.json')
    writeFileSync(file, JSON.stringify({ language: 'xx', cacheDir: '/c', excludedFolders: [], exportLayout: 'nonsense' }))
    const store = new SettingsStore(file, defaults)
    store.set({})
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.language).toBe('en')
    expect(saved.exportLayout).toBeUndefined()
  })
})
