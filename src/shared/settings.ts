import { BUDGET_KEYS, BUDGET_PRESETS, type BudgetPreset, type PlayableBudget } from '../core/checks/playable'
import type { PackageLayout } from '../core/export/unitypackage'
import { sanitizeCollections, type Collection } from './collections'

export const LANGUAGES = ['en', 'vi', 'ko'] as const
export type Language = (typeof LANGUAGES)[number]

export interface Settings {
  language: Language
  /** Where clones, downloaded files and thumbnails are cached. */
  cacheDir: string
  /** Most the downloaded files may take, in GB (absent: `DEFAULT_CACHE_LIMIT_GB`; 0: no limit). */
  cacheLimitGB?: number
  /** Folder names hidden from browsing at any depth (e.g. third-party packs). */
  excludedFolders: string[]
  /** Repo and branch opened last, restored on the next launch. */
  lastRepo?: string
  lastBranch?: string
  /** Playable budget assets are judged against (absent: the 5 MB default). */
  budgetPreset?: BudgetPreset
  /** Limits of the `custom` preset; unset ones come from the default. */
  customBudget?: Partial<PlayableBudget>
  /** Where exported packages put files in Unity (absent: `DEFAULT_EXPORT_LAYOUT`). */
  exportLayout?: PackageLayout
  /** Unity project packages are meant for (read only): exports leave out what it already has. */
  targetProject?: string
  /** Folder a team shares (network drive, synced folder) holding an index everyone takes in. */
  sharedIndexDir?: string
  /** Favourites and named collections of assets (see shared/collections). */
  collections?: Collection[]
}

export const EXPORT_LAYOUTS: readonly PackageLayout[] = ['byType', 'grouped', 'source']
export const DEFAULT_EXPORT_LAYOUT: PackageLayout = 'byType'

export const DEFAULT_EXCLUDED_FOLDERS = ['_ThirdParty']

export const CACHE_LIMITS_GB = [1, 2, 5, 10, 0] as const
export const DEFAULT_CACHE_LIMIT_GB = 2

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
    ...((CACHE_LIMITS_GB as readonly unknown[]).includes(input.cacheLimitGB) ? { cacheLimitGB: input.cacheLimitGB as number } : {}),
    excludedFolders: folders,
    ...(typeof input.lastRepo === 'string' && input.lastRepo ? { lastRepo: input.lastRepo } : {}),
    ...(typeof input.lastBranch === 'string' && input.lastBranch ? { lastBranch: input.lastBranch } : {}),
    ...((BUDGET_PRESETS as readonly unknown[]).includes(input.budgetPreset) ? { budgetPreset: input.budgetPreset as BudgetPreset } : {}),
    ...sanitizeBudget(input.customBudget),
    ...((EXPORT_LAYOUTS as readonly unknown[]).includes(input.exportLayout) ? { exportLayout: input.exportLayout as PackageLayout } : {}),
    ...(typeof input.targetProject === 'string' && input.targetProject.trim() ? { targetProject: input.targetProject } : {}),
    ...(typeof input.sharedIndexDir === 'string' && input.sharedIndexDir.trim() ? { sharedIndexDir: input.sharedIndexDir } : {}),
    ...(sanitizeCollections(input.collections) ? { collections: sanitizeCollections(input.collections) } : {})
  }
}

/** Positive finite numbers for known limits only. */
function sanitizeBudget(raw: unknown): Pick<Settings, 'customBudget'> {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  const budget: Partial<PlayableBudget> = {}
  for (const k of BUDGET_KEYS) {
    const v = input[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) budget[k] = v
  }
  return Object.keys(budget).length ? { customBudget: budget } : {}
}
