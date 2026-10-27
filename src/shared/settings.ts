export const LANGUAGES = ['en', 'vi'] as const
export type Language = (typeof LANGUAGES)[number]

export interface Settings {
  language: Language
  /** Where clones, downloaded files and thumbnails are cached. */
  cacheDir: string
  /** Folder names hidden from browsing at any depth (e.g. third-party packs). */
  excludedFolders: string[]
  /** Repo and branch opened last, restored on the next launch. */
  lastRepo?: string
  lastBranch?: string
}

export const DEFAULT_EXCLUDED_FOLDERS = ['_ThirdParty']

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Merges untrusted stored/IPC data over defaults, dropping anything invalid. */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const folders = Array.isArray(input.excludedFolders)
    ? [...new Set(input.excludedFolders.filter((f): f is string => typeof f === 'string').map((f) => f.trim()).filter(Boolean))]
    : defaults.excludedFolders
  return {
    language: isLanguage(input.language) ? input.language : defaults.language,
    cacheDir: typeof input.cacheDir === 'string' && input.cacheDir.trim() !== '' ? input.cacheDir : defaults.cacheDir,
    excludedFolders: folders,
    ...(typeof input.lastRepo === 'string' && input.lastRepo ? { lastRepo: input.lastRepo } : {}),
    ...(typeof input.lastBranch === 'string' && input.lastBranch ? { lastBranch: input.lastBranch } : {})
  }
}
