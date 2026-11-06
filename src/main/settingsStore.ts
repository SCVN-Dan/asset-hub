import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { sanitizeSettings, unknownSettings, type Settings } from '@shared/settings'

/** JSON settings file in the app's userData folder. */
export class SettingsStore {
  private current: Settings
  /** What another version of the app saved (see `unknownSettings`): written back untouched. */
  private others: Record<string, unknown>

  constructor(
    private readonly file: string,
    private readonly defaults: Settings
  ) {
    const raw = this.read()
    this.current = sanitizeSettings(raw, defaults)
    this.others = unknownSettings(raw)
  }

  get(): Settings {
    return { ...this.current }
  }

  set(patch: unknown): Settings {
    const merged = { ...this.current, ...(patch && typeof patch === 'object' ? patch : {}) }
    this.current = sanitizeSettings(merged, this.defaults)
    // Re-read: another copy of the app may have saved its own settings since this one started.
    this.others = { ...this.others, ...unknownSettings(this.read()) }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ ...this.others, ...this.current }, null, 2))
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
