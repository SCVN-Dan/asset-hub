import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { sanitizeSettings, type Settings } from '@shared/settings'

/** JSON settings file in the app's userData folder. */
export class SettingsStore {
  private current: Settings

  constructor(
    private readonly file: string,
    private readonly defaults: Settings
  ) {
    this.current = sanitizeSettings(this.read(), defaults)
  }

  get(): Settings {
    return { ...this.current }
  }

  set(patch: unknown): Settings {
    const merged = { ...this.current, ...(patch && typeof patch === 'object' ? patch : {}) }
    this.current = sanitizeSettings(merged, this.defaults)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.current, null, 2))
    renameSync(tmp, this.file)
    return this.get()
  }

  private read(): unknown {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return undefined
    }
  }
}
