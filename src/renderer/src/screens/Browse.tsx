import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { displayName } from '@shared/displayName'
import {
  AssetSearch,
  type CatalogAsset,
  buildFolderTree,
  findUnityProjectRoots,
  formatBytes,
  isInExcludedFolder,
  isInFolder,
  projectEntries,
  type Asset,
  type AssetFacts,
  type AssetSource,
  type DependencyReport,
  type FactKind,
  type HandlerRegistry,
  type RepoRef,
  type TreeEntry
} from '@core/index'
import { AssetCard, SkeletonCard } from '../components/AssetCard'
import { AssetDetails } from '../components/AssetDetails'
import { ExportBar, packCapacity, type ExportOptions, type ExportState, type PackItem } from '../components/ExportBar'
import { unwrap } from '../remoteSource'
import { useThumbnailQueue, type ThumbKind } from '../useThumbnailQueue'
import { Dropdown } from '../components/Dropdown'
import { Picker } from '../components/Picker'
import { ErrorNote } from '../components/ErrorNote'
import { FolderTree } from '../components/FolderTree'
import { GearIcon, RefreshIcon } from '../components/Icons'
import { LogoMark } from '../components/Logo'
import { VersionBadge } from '../components/VersionBadge'
import { flyToPack } from '../motion'
import { SearchBox } from '../components/SearchBox'
import { DRAWABLE } from '../viewer/formats'
import { CatalogDetails, CatalogStatusLine, locationNote, ScopeTabs } from '../components/CatalogPanel'
import { useCatalog, type SearchScope } from '../useCatalog'
import { BUDGET_PRESETS, mergeStats, rankForPlayable, summaryIssues, type BudgetPreset, type SortMode, type StatsSummary } from '@core/checks/playable'
import { useBudget } from '../budget'
import { parseAssetLink } from '@shared/deeplink'
import type { ExportRequest, RunningUnity } from '@shared/ipc'
import { FX_THUMB_VERSION, motionKey } from '../viewer/particleThumb'
import { ANIM_THUMB_VERSION, MODEL_THUMB_VERSION } from '../viewer/thumbVersions'
import { useSharedImports } from '../useSharedIndex'
import { Splitter, useStoredSize } from '../components/Splitter'
import { CollectionButtons, CollectionsNav, CollectionView, RecentNav } from '../components/Collections'
import { addCollection, deleteCollection, FAVORITES, inCollection, pushRecent, RECENT_EXPORTED, RECENT_VIEWED, renameCollection, toggleItem, withFavorites, type Collection, type CollectionItem, type RecentLists } from '@shared/collections'
import { assetRef, matchRepos, parseAssetRef } from '@shared/aiTools'
import { useAiTools, waitFor } from '../useAiTools'
import { offerChoices } from '../aiChat'
import { MultiBar } from '../components/MultiBar'
import { ShortcutHelp } from '../components/ShortcutHelp'
import { WatchNav } from '../components/WatchNav'
import type { WatchedBranch } from '@shared/settings'

interface Props {
  source: AssetSource
  registry: HandlerRegistry
  excludedFolders: string[]
  /** Signed-in GitHub login, shown in the top bar. */
  login?: string
  /** Repo/branch to reopen when they still exist. */
  initialRepo?: string
  initialBranch?: string
  onOpenBranch(repo: string, branch: string): void
  onSettings(): void
  /** Playable budget preset: switchable next to the ranking, like in Settings. */
  budgetPreset: BudgetPreset
  onBudgetPreset(preset: BudgetPreset): void
  /** Kept in settings: it also applies to exports started outside the export bar, and survives restarts. */
  exportLayout: ExportOptions['layout']
  onExportLayout(layout: ExportOptions['layout']): void
  /** Unity project exports are compared with (settings), if any. */
  targetProject?: string
  /** Favourites and named collections (settings). */
  collections?: Collection[]
  onCollections(collections: Collection[]): void
  /** Branches followed for new assets, and saving them. */
  watched: WatchedBranch[]
  onWatched(watched: WatchedBranch[]): void
  /** Recently viewed / exported assets, and saving them. */
  recent?: RecentLists
  onRecent(recent: RecentLists): void
}

const ALL = 'all'
/** Cards rendered per step while scrolling. */
const PAGE = 60
/** Models bigger than this are only rendered when opened, not for grid thumbnails. */
const THUMB_MAX_BYTES = 40 * 1024 * 1024
/** Images are decoded on the page: very large PSDs would stall it, so they are only drawn when opened. */
const IMAGE_THUMB_MAX_BYTES = 24 * 1024 * 1024
/** Clips the browser decodes; their waveform is the thumbnail. */
const PLAYABLE_AUDIO = /\.(wav|mp3|ogg)$/i
const AUDIO_THUMB_MAX_BYTES = 24 * 1024 * 1024
/** CJK fonts run to tens of MB: their cards keep the icon until opened. */
const FONT_THUMB_MAX_BYTES = 20 * 1024 * 1024
/** Unity project folder of a repo path (the part before "Assets/"), for textures looked up next to it. */
/** Quick filters above the grid. */
const QUICK_CHIPS = ['small', 'lowPoly', 'animated'] as const
type QuickChip = (typeof QUICK_CHIPS)[number]

const projectRootOf = (path: string) => {
  const i = path.indexOf('Assets/')
  return i < 0 ? '' : path.slice(0, i)
}
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** PNG preview for Unity's import dialog, from a cached thumbnail data URL. */
async function thumbToPng(src: string, size = 128): Promise<Uint8Array | undefined> {
  try {
    const img = new Image()
    // Thumbnails from the cache come from their own scheme: drawn without tainting the canvas.
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const scale = Math.max(size / img.width, size / img.height)
    canvas.getContext('2d')!.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
  } catch {
    return undefined
  }
}

/** 'owner/repo' → 'owner/' */
const ownerPrefix = (fullName: string) => fullName.slice(0, fullName.indexOf('/') + 1)
/** 'vn/net-catch' → 'vn/'; branches without a slash are ungrouped. */
const branchPrefix = (name: string) => (name.includes('/') ? name.slice(0, name.indexOf('/') + 1) : '')

type Load<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }

export function Browse({
  source,
  registry,
  excludedFolders,
  login,
  initialRepo,
  initialBranch,
  onOpenBranch,
  onSettings,
  budgetPreset,
  onBudgetPreset,
  exportLayout,
  onExportLayout,
  targetProject,
  collections: storedCollections,
  recent,
  onRecent,
  watched,
  onWatched,
  onCollections
}: Props) {
  const { t } = useTranslation()
  // Collections: one may be open in the grid instead of the branch's folders.
  const collections = withFavorites(storedCollections)
  const [openCollection, setOpenCollection] = useState<string>()
  const recentLists: Collection[] = [
    { id: RECENT_VIEWED, name: '', items: recent?.viewed ?? [] },
    { id: RECENT_EXPORTED, name: '', items: recent?.exported ?? [] }
  ]
  const shownCollection = [...collections, ...recentLists].find((c) => c.id === openCollection)
  /** Remembers assets in a recent list (the latest settings are read at the time). */
  const recentRef = useRef(recent)
  recentRef.current = recent
  const remember = (list: keyof RecentLists, items: CollectionItem[]) => {
    if (!items.length) return
    const now = recentRef.current ?? { viewed: [], exported: [] }
    onRecent({ ...now, [list]: pushRecent(now[list], items) })
  }
  const favorites = new Set(collections[0].items.map((i) => `${i.repo}\n${i.path}`))
  // Detail panel width and preview height, as each person drags them (kept on this machine).
  const [detailsWidth, setDetailsWidth] = useStoredSize('assethub.detailsWidth')
  const [viewerHeight, setViewerHeight] = useStoredSize('assethub.viewerHeight')
  const budget = useBudget()
  const [repos, setRepos] = useState<Load<RepoRef[]>>({ status: 'loading' })
  const [repo, setRepo] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  /** Repo the current branch was listed for; until it matches `repo`, the branch is stale. */
  const [branchRepo, setBranchRepo] = useState('')
  const [tree, setTree] = useState<Load<TreeEntry[]>>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [root, setRoot] = useState('')
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [folder, setFolder] = useState('')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('branch')
  /** Selected result in the other-branches / other-repos views (its blob SHA). */
  const [catalogSel, setCatalogSel] = useState<string>()
  /** Where to land once a branch opened from another view has loaded. */
  const nav = useRef<{ repo: string; branch: string; path: string }>()
  const [selectedId, setSelectedId] = useState<string>()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  /** Model measurements by blob SHA, for ranking. */
  const [modelStats, setModelStats] = useState<Record<string, StatsSummary>>({})
  const [sortMode, setSortMode] = useState<SortMode>('relevance')
  const [onlyFits, setOnlyFits] = useState(false)
  /** Saved thumbnails are known; only then is it worth rendering missing ones. */
  const [thumbsLoaded, setThumbsLoaded] = useState(false)
  const [mergeCopies, setMergeCopies] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)
  const [pack, setPack] = useState<PackItem[]>([])
  const [skipByName, setSkipByName] = useState(false)
  const [reuseExisting, setReuseExisting] = useState(true)
  const [stripScripts, setStripScripts] = useState(true)
  const exportOptions: ExportOptions = { layout: exportLayout, skipByName, targetProject, reuseExisting, stripScripts }
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const reports = useRef(new Map<string, DependencyReport>())
  /** Materials found on prefabs, by model path: exported along with the model. */
  const prefabFiles = useRef(new Map<string, string[]>())

  useEffect(
    () => window.api.exporter.onProgress((progress) => setExportState((s) => (s.status === 'running' ? { status: 'running', progress } : s))),
    []
  )
  // A pack belongs to one repo + branch + project (its paths are relative to the project root).
  useEffect(() => {
    setPack([])
    reports.current.clear()
    prefabFiles.current.clear()
  }, [repo, branch, root])

  useEffect(() => {
    let cancelled = false
    setRepos({ status: 'loading' })
    source.listRepos().then(
      (list) => {
        if (cancelled) return
        setRepos({ status: 'ready', data: list })
        const has = (name?: string) => !!name && list.some((r) => r.fullName === name)
        setRepo((current) => (has(current) ? current : has(initialRepo) ? initialRepo! : (list[0]?.fullName ?? '')))
      },
      (error: unknown) => !cancelled && setRepos({ status: 'error', error })
    )
    return () => {
      cancelled = true
    }
  }, [source])

  const repoList = repos.status === 'ready' ? repos.data : []
  const repoNames = useMemo(() => repoList.map((r) => r.fullName), [repoList])
  const defaultBranch = repoList.find((r) => r.fullName === repo)?.defaultBranch

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    setBranches([])
    setBranch('')
    setTree({ status: 'loading' })
    source.listBranches(repo).then(
      (list) => {
        if (cancelled) return
        setBranches(list)
        setBranchRepo(repo)
        const preferred = repoList.find((r) => r.fullName === repo)?.defaultBranch
        const wanted = nav.current?.repo === repo ? nav.current.branch : undefined
        if (wanted && list.includes(wanted)) setBranch(wanted)
        else if (repo === initialRepo && initialBranch && list.includes(initialBranch)) setBranch(initialBranch)
        else setBranch(preferred && list.includes(preferred) ? preferred : (list[0] ?? ''))
      },
      (error: unknown) => !cancelled && setTree({ status: 'error', error })
    )
    return () => {
      cancelled = true
    }
    // repoList is read only for the default branch; it must not retrigger branch loading.
  }, [source, repo])

  useEffect(() => {
    if (!repo || !branch || branchRepo !== repo) return
    onOpenBranch(repo, branch)
    let cancelled = false
    setTree({ status: 'loading' })
    source.listTree(repo, branch).then(
      (entries) => {
        if (cancelled) return
        setTree({ status: 'ready', data: entries })
        const roots = findUnityProjectRoots(entries)
        setRoot((current) => (roots.includes(current) ? current : (roots[0] ?? '')))
        setFolder('')
        setSelectedId(undefined)
        if (nav.current?.repo === repo && nav.current.branch === branch) {
          // Opening a branch without a file (a watched branch) only picks the branch.
          if (nav.current.path) land(entries, nav.current.path)
          else nav.current = undefined
        }
      },
      (error: unknown) => !cancelled && setTree({ status: 'error', error })
    )
    return () => {
      cancelled = true
    }
  }, [source, repo, branch, reloadKey, branchRepo])

  const roots = useMemo(() => (tree.status === 'ready' ? findUnityProjectRoots(tree.data) : []), [tree])
  const allAssets = useMemo(() => {
    if (tree.status !== 'ready') return []
    // Without a Unity project marker, show the repo as-is.
    const entries = roots.length ? projectEntries(tree.data, root) : tree.data
    return registry.collectAssets(entries)
  }, [tree, roots, root, registry])
  const assets = useMemo(() => allAssets.filter((a) => !isInExcludedFolder(a.path, excludedFolders)), [allAssets, excludedFolders])
  const hiddenCount = allAssets.length - assets.length
  // Clip names of measured models, keyed so the search is rebuilt only when they change (not on every thumbnail).
  const clipKey = Object.entries(modelStats)
    .filter(([, s]) => s.clips > 0 && s.clipNames)
    .map(([sha, s]) => `${sha}:${s.clipNames!.join(',')}`)
    .sort()
    .join('|')
  const clipNames = useMemo(() => new Map(Object.entries(modelStats).flatMap(([sha, s]) => (s.clipNames ? [[sha, s.clipNames] as const] : []))), [clipKey])
  /** Shas of models known to hold clips, for tabs that list them (`alsoShows`). */
  /** Shown anyway: assets their handler leaves out of lists (clips no model was found for). */
  const [showUnlisted, setShowUnlisted] = useState(false)
  const unlistedKey = useMemo(() => Object.entries(modelStats).filter(([, s]) => s.rigged === false).map(([sha]) => sha).sort().join('|'), [modelStats])
  const withClips = useMemo(() => Object.entries(modelStats).filter(([, s]) => s.clips > 0).map(([sha]) => sha).sort().join('|'), [modelStats])
  /** Shas measured as effects or not (particles read), for the effects tab. */
  const withParticles = useMemo(() => Object.entries(modelStats).filter(([, s]) => s.particles !== undefined).map(([sha, s]) => `${sha}:${s.emitters ?? 0}`).sort().join('|'), [modelStats])
  /** Assets known by reading them (effect prefabs, sprites, TextMeshPro fonts), by blob SHA, from every branch scanned so far. */
  const [known, setKnown] = useState<AssetFacts>({})
  const [scan, setScan] = useState<{ kind: FactKind; status: 'scanning' | 'error'; done: number; total: number }>()
  /** Scans started (or done), as "kind:repo@branch". */
  const scans = useRef(new Set<string>())
  /** In the open tab: its own type, or another type the tab's handler also lists. */
  const listed = useCallback((a: Asset) => showUnlisted || !registry.get(a.type)?.unlisted?.(modelStats[a.sha]), [registry, showUnlisted, unlistedKey])
  const inTab = useCallback(
    (a: Asset, tab: string) =>
      tab === ALL ? !registry.get(a.type)?.hidden && listed(a) : (a.type === tab && listed(a)) || !!registry.get(tab)?.alsoShows?.(a, modelStats[a.sha], known),
    // modelStats matters only through which models hold clips, which prefabs are effects and which clips have no model.
    [registry, withClips, withParticles, known, listed]
  )
  /** In the open tab but left out (see `listed`), for the offer to show them. */
  const unlistedCount = useMemo(
    () => (showUnlisted || !unlistedKey ? 0 : assets.filter((a) => registry.get(a.type)?.unlisted?.(modelStats[a.sha]) && (typeFilter === ALL || a.type === typeFilter)).length),
    [assets, registry, typeFilter, showUnlisted, unlistedKey]
  )
  /** Every model of the branch, as repo paths (rigs to play clips on). */
  const modelPaths = useMemo(() => assets.filter((a) => registry.get(a.type)?.preview.kind === 'three').map((a) => root + a.path), [assets, registry, root])
  const ofType = useMemo(() => (typeFilter === ALL ? assets : assets.filter((a) => inTab(a, typeFilter))), [assets, typeFilter, inTab])
  const folderRoot = useMemo(() => buildFolderTree(ofType), [ofType])
  const searcher = useMemo(() => new AssetSearch(ofType, (a) => clipNames.get(a.sha) ?? []), [ofType, clipNames])
  // Matches groups (fish → shark), typos and folder names, best matches first.
  const found = useMemo(() => searcher.search(query), [searcher, query])
  const visible = useMemo(() => found.assets.filter((a) => isInFolder(a.path, folder)), [found, folder])
  // Same blob SHA = byte-identical file; with merging on, one card stands for all copies.
  const copiesBySha = useMemo(() => {
    const map = new Map<string, Asset[]>()
    for (const a of ofType) map.set(a.sha, [...(map.get(a.sha) ?? []), a])
    return map
  }, [ofType])
  const shown = useMemo(() => {
    if (!mergeCopies) return visible
    const seen = new Set<string>()
    return visible.filter((a) => !seen.has(a.sha) && (seen.add(a.sha), true))
  }, [visible, mergeCopies])
  const merged = visible.length - shown.length
  const selected = visible.find((a) => a.id === selectedId)

  const catalog = useCatalog(scope, repo, branch, excludedFolders, true)
  const [catalogRepo, setCatalogRepo] = useState('')
  const [catalogBranch, setCatalogBranch] = useState('')
  useEffect(() => {
    setCatalogRepo('')
    setCatalogBranch('')
  }, [scope])
  /** Repos and branches present in the results, most files first, for the filters. */
  const catalogFacets = useMemo(() => {
    const repos = new Map<string, number>()
    const branches = new Map<string, number>()
    for (const a of catalog.assets ?? [])
      for (const l of a.locations) {
        repos.set(l.repo, (repos.get(l.repo) ?? 0) + 1)
        if (!catalogRepo || l.repo === catalogRepo) for (const b of l.branches) branches.set(b, (branches.get(b) ?? 0) + 1)
      }
    const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return { repos: sorted(repos), branches: sorted(branches) }
  }, [catalog.assets, catalogRepo])
  const catalogOfType = useMemo(
    () =>
      (catalog.assets ?? []).filter(
        (a) =>
          inTab(a, typeFilter) &&
          (!catalogRepo && !catalogBranch
            ? true
            : a.locations.some((l) => (!catalogRepo || l.repo === catalogRepo) && (!catalogBranch || l.branches.includes(catalogBranch))))
      ),
    [catalog.assets, typeFilter, catalogRepo, catalogBranch, inTab]
  )
  const catalogSearch = useMemo(() => new AssetSearch(catalogOfType, (a) => clipNames.get(a.sha) ?? []), [catalogOfType, clipNames])
  const catalogFound = useMemo(() => catalogSearch.search(query), [catalogSearch, query])
  const catalogShown = catalogFound.assets as CatalogAsset[]
  const catalogSelected = catalogShown.find((a) => a.sha === catalogSel)
  const inCatalog = scope !== 'branch'
  /** Cards in the grid, whichever view is open. */
  // Ordered and filtered for reuse in playables (measurements come from thumbnails and opened models).
  // Watched branches: what was added since each was last marked seen (checked on opening, every 30 minutes, on coming back).
  const [news, setNews] = useState<Record<string, { head: string; added: string[]; more: boolean }>>({})
  const watchKey = (r: string, b: string) => `${r}\n${b}`
  const watchedKey = watched.map((w) => `${watchKey(w.repo, w.branch)}\n${w.seen}`).join('|')
  const lastCheck = useRef(0)
  useEffect(() => {
    const check = () => {
      lastCheck.current = Date.now()
      for (const w of watched)
        void window.api.source.watchCheck(w.repo, w.branch, w.seen).then((r) => r.ok && setNews((n) => ({ ...n, [watchKey(w.repo, w.branch)]: r.data })))
    }
    check()
    const timer = window.setInterval(check, 30 * 60_000)
    const onFocus = () => Date.now() - lastCheck.current > 5 * 60_000 && check()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [watchedKey])
  const watchingHere = watched.some((w) => w.repo === repo && w.branch === branch)
  const newHere = useMemo(() => new Set(watchingHere ? (news[watchKey(repo, branch)]?.added ?? []) : []), [news, repo, branch, watchingHere])
  const [newOnly, setNewOnly] = useState(false)
  useEffect(() => setNewOnly(false), [repo, branch])
  const toggleWatch = async () => {
    if (watchingHere) return onWatched(watched.filter((w) => !(w.repo === repo && w.branch === branch)))
    // From now on: whatever is on the branch today counts as seen.
    const r = await window.api.source.watchCheck(repo, branch, '')
    if (r.ok) onWatched([...watched, { repo, branch, seen: r.data.head }])
  }
  const markSeen = () => {
    const head = news[watchKey(repo, branch)]?.head
    if (!head) return
    onWatched(watched.map((w) => (w.repo === repo && w.branch === branch ? { ...w, seen: head } : w)))
    setNews((n) => ({ ...n, [watchKey(repo, branch)]: { head, added: [], more: false } }))
    setNewOnly(false)
  }
  /** Opens a branch (no file), e.g. a watched one from the sidebar. */
  const openBranch = (toRepo: string, toBranch: string) => {
    setScope('branch')
    setOpenCollection(undefined)
    if (toRepo !== repo) {
      nav.current = { repo: toRepo, branch: toBranch, path: '' }
      setRepo(toRepo)
    } else setBranch(toBranch)
  }

  /** Quick filters over the cards; those on measurements only keep measured assets. */
  const [chips, setChips] = useState<QuickChip[]>([])
  const passesChips = useCallback(
    (a: Asset) => {
      if (newOnly && !newHere.has(root + a.path)) return false
      const s = modelStats[a.sha]
      return chips.every((c) =>
        c === 'small' ? (a.size ?? Infinity) <= 500 * 1024 : c === 'lowPoly' ? !!s && s.triangles > 0 && s.triangles <= 5000 : a.type === 'animation' || (!!s && s.clips > 0)
      )
    },
    [chips, modelStats, newOnly, newHere, root]
  )
  const rankedShown = useMemo(
    () => rankForPlayable(
        (onlyFits && budget ? shown.filter((a) => modelStats[a.sha] && !summaryIssues(modelStats[a.sha], budget).length) : shown).filter(passesChips),
        sortMode === 'used' || (sortMode === 'playable' && !budget) ? 'relevance' : sortMode,
        (a) => modelStats[a.sha],
        undefined,
        (a) => found.scores.get(a.id) ?? 0,
        budget
      ),
    [shown, sortMode, onlyFits, modelStats, found, budget, passesChips]
  )
  const rankedCatalog = useMemo(
    () =>
      rankForPlayable(
        (onlyFits && budget ? catalogShown.filter((a) => modelStats[a.sha] && !summaryIssues(modelStats[a.sha], budget).length) : catalogShown).filter(passesChips),
        sortMode === 'playable' && !budget ? 'relevance' : sortMode,
        (a) => modelStats[a.sha],
        (a) => a.branchCount,
        (a) => catalogFound.scores.get(a.id) ?? 0,
        budget
      ),
    [catalogShown, sortMode, onlyFits, modelStats, catalogFound, budget, passesChips]
  )
  const gridItems: readonly Asset[] = inCatalog ? rankedCatalog : rankedShown
  const measuredCount = (inCatalog ? catalogShown : shown).filter((a) => modelStats[a.sha]).length
  const unmeasured = (inCatalog ? catalogShown : shown).filter((a) => !modelStats[a.sha])
  const gridSelected = inCatalog ? catalogSel : selectedId
  const setGridSelected = inCatalog ? setCatalogSel : setSelectedId
  const searchFound = inCatalog ? catalogFound : found

  // Saved thumbnails of results from other branches (same content = same thumbnail).
  useEffect(() => {
    if (!catalog.assets?.length) return
    let cancelled = false
    void window.api.thumbs.get(catalog.assets.map((a) => a.sha)).then((more) => !cancelled && setThumbs((prev) => ({ ...more, ...prev })))
    void window.api.stats.get(catalog.assets.map((a) => a.sha)).then((more) => !cancelled && setModelStats((prev) => ({ ...more, ...prev })))
    return () => {
      cancelled = true
    }
  }, [catalog.assets])

  /** Selects `repoPath` in the loaded branch: picks its Unity project and clears filters that would hide it. */
  function land(entries: readonly TreeEntry[], repoPath: string) {
    nav.current = undefined
    const roots = findUnityProjectRoots(entries)
    const projectRoot = [...roots].reverse().find((r) => repoPath.startsWith(r + 'Assets/')) ?? ''
    setRoot(projectRoot)
    setFolder('')
    setQuery('')
    setTypeFilter(ALL)
    setSelectedId(repoPath.slice(projectRoot.length))
  }

  /** Where to read a result from for its thumbnail: the filtered repo / branch when set, else its main location. */
  const catalogSource = (a: CatalogAsset) => {
    const at = a.locations.find((l) => !catalogRepo || l.repo === catalogRepo) ?? a.locations[0]
    const atBranch = catalogBranch && at.branches.includes(catalogBranch) ? catalogBranch : at.branches[0]
    return { path: at.path, ctx: { repo: at.repo, branch: atBranch, root: projectRootOf(at.path) } }
  }
  const previewKind = (a: Asset) => registry.get(a.type)?.preview.kind
  /** Thumbnails: models up to THUMB_MAX_BYTES, images the browser (or our PSD / TGA decoders) can draw. */
  const canRender = (a: Asset) =>
    (previewKind(a) === 'three' && (a.size ?? 0) <= THUMB_MAX_BYTES) ||
    previewKind(a) === 'material' ||
    previewKind(a) === 'prefab' ||
    previewKind(a) === 'animation' ||
    (previewKind(a) === 'font' && (a.size ?? 0) <= FONT_THUMB_MAX_BYTES) ||
    (previewKind(a) === 'tmpfont' && (a.size ?? 0) <= FONT_THUMB_MAX_BYTES) ||
    (previewKind(a) === 'image' && DRAWABLE.test(a.path) && (a.size ?? 0) <= IMAGE_THUMB_MAX_BYTES) ||
    (previewKind(a) === 'audio' && PLAYABLE_AUDIO.test(a.path) && (a.size ?? 0) <= AUDIO_THUMB_MAX_BYTES)
  const kindOf = (a: Asset): ThumbKind => {
    const kind = previewKind(a)
    return kind === 'image' || kind === 'material' || kind === 'audio' || kind === 'prefab' || kind === 'animation' || kind === 'font' || kind === 'tmpfont' ? kind : 'three'
  }

  /** Cards whose thumbnail is ready, out of those that can have one (huge or EXR files never do). */
  const renderable = gridItems.filter(canRender)
  const loadedCount = renderable.filter((a) => thumbs[a.sha]).length

  /** Prefab cards drawn without numbers (effects as a plain "FX" before particles were read), or effect / clip cards drawn the old way: tried once per session. */
  const unmeasuredPrefabs = useRef(new Set<string>())
  /** An effect card older than the current way of drawing them (textures piled up, one frame). */
  const staleEffect = (a: Asset) => kindOf(a) === 'prefab' && !!modelStats[a.sha]?.particles && modelStats[a.sha]?.fxThumb !== FX_THUMB_VERSION && !unmeasuredPrefabs.current.has(a.sha)
  /** A clip card drawn before the rig search last improved (shown as curves when no rig was found then). */
  const staleClip = (a: Asset) => kindOf(a) === 'animation' && modelStats[a.sha]?.animThumb !== ANIM_THUMB_VERSION && !unmeasuredPrefabs.current.has(a.sha)
  /** A model or prefab card drawn before the last fix to how they are drawn (some came out empty). */
  const staleModel = (a: Asset) => (kindOf(a) === 'three' || kindOf(a) === 'prefab') && !!modelStats[a.sha] && modelStats[a.sha].modelThumb !== MODEL_THUMB_VERSION && !unmeasuredPrefabs.current.has(a.sha)
  const remeasure = (a: Asset) => {
    const s = modelStats[a.sha]
    if (!s) return kindOf(a) === 'prefab' && !!thumbs[a.sha] && !unmeasuredPrefabs.current.has(a.sha)
    return (s.clips > 0 && !s.clipNames) || (kindOf(a) === 'three' && s.source === 'thumb' && !s.matTextures) || staleEffect(a) || staleClip(a) || staleModel(a)
  }

  /** Queues a card's thumbnail, read from the open branch or (for results elsewhere) its main location. */
  const requestThumb = (a: Asset, order: number) => {
    if (inCatalog) {
      const src = catalogSource(a as CatalogAsset)
      thumbQueue.request(a.sha, src.path, order, src.ctx, kindOf(a))
    } else thumbQueue.request(a.sha, root + a.path, order, undefined, kindOf(a))
  }

  /** Renders (and so measures) every listed model not measured yet, top of the list first. */
  const measureAll = () => {
    unmeasured.forEach((a, i) => {
      if (canRender(a)) requestThumb(a, 10_000 + i)
    })
  }

  /** Exports a result from another branch / repo as it is on its main branch, without opening that branch. */
  const exportFromCatalog = async (a: CatalogAsset, unity?: RunningUnity) => {
    const at = a.locations[0]
    setExportState({ status: 'running' })
    const thumb = thumbs[a.sha]
    const png = thumb ? await thumbToPng(thumb) : undefined
    try {
      const result = await sendPackage(
        {
          repo: at.repo,
          branch: at.branches[0],
          root: projectRootOf(at.path),
          paths: [at.path],
          ...exportOptions,
          extraFiles: [],
          previews: png ? { [at.path]: png } : {},
          suggestedName: a.name.replace(/\.[^.]+$/, '')
        },
        unity
      )
      setExportState(result.canceled ? { status: 'idle' } : { status: 'done', result })
      if (!result.canceled) remember('exported', [catalogItem(a)])
    } catch (error) {
      setExportState({ status: 'error', error })
    }
  }

  /** Opens a file found in another branch or repo there, in the normal branch view. */
  const openLocation = (toRepo: string, toBranch: string, path: string) => {
    setScope('branch')
    nav.current = { repo: toRepo, branch: toBranch, path }
    if (toRepo !== repo) setRepo(toRepo)
    else if (toBranch !== branch) setBranch(toBranch)
    else if (tree.status === 'ready') land(tree.data, path)
  }

  // assethub:// links open the asset they name: the link that launched the app, links clicked
  // while it runs, and links pasted into the search box.
  const openLocationRef = useRef(openLocation)
  openLocationRef.current = openLocation
  useEffect(() => {
    const take = async () => {
      const url = await window.api.takeDeepLink()
      const link = url ? parseAssetLink(url) : undefined
      if (link) openLocationRef.current(link.repo, link.branch, link.path)
    }
    void take()
    return window.api.onDeepLink(() => void take())
  }, [])
  const onQuery = (q: string) => {
    const link = parseAssetLink(q)
    if (!link) {
      setOpenCollection(undefined)
      return setQuery(q)
    }
    setQuery('')
    openLocation(link.repo, link.branch, link.path)
  }

  // Back to the first page only when the user asks for a different list, not when
  // measurements arrive and re-rank it (that used to jump the grid back to the top).
  const listKey = [scope, repo, branch, root, folder, typeFilter, query, sortMode, onlyFits, mergeCopies, catalogRepo, catalogBranch].join('\n')
  useEffect(() => setLimit(PAGE), [listKey])
  // Render more cards as the end of the grid scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [gridItems, limit])

  // Arrow keys move the selection through the grid (Up/Down jump a row).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey || !gridItems.length) return
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, .picker-pop, .viewer')) return
      const grid = document.querySelector('.grid')
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1
      const index = gridItems.findIndex((a) => a.id === gridSelected)
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols
      const next = index < 0 ? 0 : Math.min(gridItems.length - 1, Math.max(0, index + step))
      e.preventDefault()
      setGridSelected(gridItems[next].id)
      if (next >= limit) setLimit(next + PAGE)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gridItems, gridSelected, limit, inCatalog])

  /** Selection still to be scrolled into view; scrolling happens only when the selection changes. */
  const scrollTo = useRef<string>()
  useEffect(() => {
    scrollTo.current = gridSelected
  }, [gridSelected])
  useEffect(() => {
    const wanted = scrollTo.current
    if (!wanted) return
    // A card further down than the cards rendered so far (e.g. opened from another branch): render up to it first.
    const target = gridItems.find((a) => a.id === wanted) ?? (selected && gridItems.find((a) => a.sha === selected.sha))
    const index = target ? gridItems.indexOf(target) : -1
    if (index >= limit) {
      setLimit(index + PAGE)
      return
    }
    scrollTo.current = undefined
    const card = target && document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(target.id)}"]`)
    card?.scrollIntoView({ block: 'nearest' })
    if (document.activeElement?.classList.contains('asset-card')) card?.focus({ preventScroll: true })
  }, [gridSelected, gridItems, limit])
/** An asset of this branch as a collection keeps it: where it is, so it opens there again. */
  const itemOf = (a: Asset): CollectionItem => ({ repo, branch, path: root + a.path, sha: a.sha, name: a.name, type: a.type, ...(a.size !== undefined ? { size: a.size } : {}) })
  /** A result of another branch / repo, where it lives first. */
  const catalogItem = (a: CatalogAsset): CollectionItem => {
    const at = a.locations[0]
    return { repo: at.repo, branch: at.branches[0], path: at.path, sha: a.sha, name: a.name, type: a.type, ...(a.size !== undefined ? { size: a.size } : {}) }
  }
  const live = useMemo(
    () => (!repo || !branch || branchRepo !== repo ? undefined : { repo, branch, root }),
    [source, repo, branch, branchRepo, root]
  )

  // Tabs that list assets by what is inside them (VFX, Sprite, TextMeshPro fonts) need the branch's files read once
  // (kept by SHA, shared by all branches): started the first time such a tab is opened, finished even if the user moves on.
  useEffect(() => {
    const kind = registry.get(typeFilter)?.facts
    if (!kind || !live) return
    const key = `${kind}:${live.repo}@${live.branch}`
    if (scans.current.has(key)) return
    scans.current.add(key)
    const add = (shas: readonly string[]) => setKnown((prev) => ({ ...prev, [kind]: new Set([...(prev[kind] ?? []), ...shas]) }))
    setScan({ kind, status: 'scanning', done: 0, total: 0 })
    const off = window.api.assets.onKnownProgress((k, { found, ...p }) => {
      if (k !== kind) return
      setScan((s) => (s?.kind === kind && s.status === 'scanning' ? { ...s, ...p } : s))
      // Assets appear as they are found, not only when every file has been read.
      if (found?.length) add(found)
    })
    void window.api.assets
      .knownAssets(live.repo, live.branch, kind)
      .then(unwrap)
      .then(
        (shas) => {
          add(shas)
          setScan((s) => (s?.kind === kind ? undefined : s))
        },
        () => {
          // Tried again the next time the tab is opened.
          scans.current.delete(key)
          setScan({ kind, status: 'error', done: 0, total: 0 })
        }
      )
      .finally(off)
  }, [typeFilter, live, registry])

  const sharedImports = useSharedImports()
  // Saved thumbnails and measurements of an open collection's assets, from any repo or branch (by content).
  const collectionShas = shownCollection?.items.map((i) => i.sha).join(',') ?? ''
  useEffect(() => {
    if (!collectionShas) return
    let cancelled = false
    const keys = collectionShas.split(',')
    void window.api.thumbs.get(keys).then((more) => !cancelled && setThumbs((prev) => ({ ...more, ...prev })), () => undefined)
    void window.api.stats.get(keys).then((more) => !cancelled && setModelStats((prev) => ({ ...more, ...prev })), () => undefined)
    return () => {
      cancelled = true
    }
  }, [collectionShas, thumbsLoaded])
  // Thumbnails rendered earlier, keyed by the model's content hash.
  useEffect(() => {
    setThumbsLoaded(false)
    if (!allAssets.length) return
    let cancelled = false
    const keys = allAssets.map((a) => a.sha)
    // Both known before rendering starts, so nothing is rendered or measured twice.
    void Promise.all([window.api.thumbs.get(keys).catch(() => ({})), window.api.stats.get(keys).catch(() => ({}))]).then(([found, measured]) => {
      if (cancelled) return
      setThumbs(found)
      setModelStats((prev) => ({ ...prev, ...measured }))
      setThumbsLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // Read again when a teammate's index brought thumbnails and numbers in.
  }, [source, allAssets, sharedImports])

  /** Saves a package, or with `unity` opens it in that editor (its import dialog). */
  const sendPackage = async (request: ExportRequest, unity?: RunningUnity) =>
    unwrap(await (unity ? window.api.exporter.importToUnity(request, unity.pid) : window.api.exporter.unityPackage(request)))
  const runExport = async (items: PackItem[], unity?: RunningUnity) => {
    if (!live || !items.length) return
    setExportState({ status: 'running' })
    const previews: Record<string, Uint8Array> = {}
    for (const item of items) {
      const thumb = thumbs[item.asset.sha]
      const png = thumb ? await thumbToPng(thumb) : undefined
      if (png) previews[item.path] = png
    }
    const suggestedName = items.length === 1 ? items[0].asset.name.replace(/\.[^.]+$/, '') : `${live.repo.split('/').pop()}-${items.length}-assets`
    try {
      const result = await sendPackage({ ...live, paths: items.map((i) => i.path), ...exportOptions, extraFiles: items.flatMap((i) => prefabFiles.current.get(i.path) ?? []), previews, suggestedName }, unity)
      setExportState(result.canceled ? { status: 'idle' } : { status: 'done', result })
      if (!result.canceled) remember('exported', items.map((i) => itemOf(i.asset)))
    } catch (error) {
      setExportState({ status: 'error', error })
    }
  }

  const packItem = (asset: Asset): PackItem => ({ asset, path: root + asset.path, report: reports.current.get(root + asset.path) })
  const togglePack = (asset: Asset) => {
    const adding = !pack.some((i) => i.asset.id === asset.id)
    setPack((items) => (items.some((i) => i.asset.id === asset.id) ? items.filter((i) => i.asset.id !== asset.id) : [...items, packItem(asset)]))
    if (adding) flyToPack(asset.id)
  }
  /** Cards picked with Cmd/Ctrl- or Shift-click in the branch view, to act on several at once. */
  const [picked, setPicked] = useState<string[]>([])
  const pickAnchor = useRef<string>()
  const pickedAssets = useMemo(() => picked.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a), [picked, assets])
  // Another branch, repo or view: nothing stays picked.
  useEffect(() => setPicked([]), [repo, branch, root, scope])
  const pickCard = (a: Asset, how: { toggle: boolean; range: boolean }) => {
    if (how.range && pickAnchor.current) {
      const ids = rankedShown.map((x) => x.id)
      const [from, to] = [ids.indexOf(pickAnchor.current), ids.indexOf(a.id)].sort((x, y) => x - y)
      if (from >= 0) setPicked((prev) => [...new Set([...prev, ...ids.slice(from, to + 1)])])
    } else if (how.toggle) {
      setPicked((prev) => {
        const base = prev.length ? prev : selectedId && selectedId !== a.id ? [selectedId] : []
        return base.includes(a.id) ? base.filter((id) => id !== a.id) : [...base, a.id]
      })
      pickAnchor.current = a.id
    } else {
      setPicked([])
      pickAnchor.current = a.id
    }
    setSelectedId(a.id)
  }

  // Viewed: an asset kept open for a moment (not every card the arrow keys pass through).
  const viewedKey = inCatalog ? catalogSelected && `${catalogSelected.sha}` : selected && `${repo}\n${branch}\n${root + selected.path}`
  useEffect(() => {
    if (!viewedKey) return
    const timer = window.setTimeout(() => {
      if (inCatalog && catalogSelected) remember('viewed', [catalogItem(catalogSelected)])
      else if (!inCatalog && selected) remember('viewed', [itemOf(selected)])
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [viewedKey])

  // Keyboard shortcuts (`?` lists them). Single keys only act when nothing is being typed.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const keyActions = useRef<(e: KeyboardEvent) => void>()
  keyActions.current = (e: KeyboardEvent) => {
    const typing = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
    const cmd = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (cmd && key === 'k') {
      e.preventDefault()
      const box = document.querySelector<HTMLInputElement>('.search-box input')
      box?.focus()
      box?.select()
      return
    }
    if (e.key === 'Escape' && picked.length) return setPicked([])
    if (typing || e.altKey) return
    if (cmd && key === 'a' && !inCatalog && !shownCollection) {
      e.preventDefault()
      return setPicked(rankedShown.map((a) => a.id))
    }
    if (cmd && key === 'i') {
      e.preventDefault()
      const items = picked.length > 1 ? pickedAssets : selected ? [selected] : []
      if (!items.length || exportState.status === 'running') return
      // The project used last, or the only one open; with several and none chosen yet, the button's menu decides.
      void window.api.exporter.unityEditors().then((editors) => {
        let last = ''
        try {
          last = localStorage.getItem('assethub.lastUnityProject') ?? ''
        } catch {
          // none remembered
        }
        const editor = editors.find((x) => x.projectPath === last) ?? (editors.length === 1 ? editors[0] : undefined)
        if (editor) void runExport(items.map(packItem), editor)
      })
      return
    }
    if (cmd) return
    if (e.key === '?') return setShortcutsOpen(true)
    if (!selected || inCatalog) return
    if (key === 'f') return onCollections(toggleItem(collections, FAVORITES, itemOf(selected)))
    if (key === 'e') return togglePack(selected)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyActions.current?.(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The AI pet acts in this hub: these read what is on screen now, not when the handler was made.
  const aiState = { inTab, excludedFolders, query, scope, typeFilter, gridItems, inCatalog, catalogAssets: catalog.assets, treeReady: tree.status === 'ready', repo, branch, root, assets, modelStats, budget, collections, repos: repos.status === 'ready' ? repos.data : [] }
  const latest = useRef(aiState)
  latest.current = aiState
  /** An asset as the pet sees it: a ref to name it by, and what helps choose. */
  const describeForAi = (a: Asset) => {
    const l = latest.current
    const at = (a as CatalogAsset).locations?.[0]
    const stats = l.modelStats[a.sha]
    return {
      ref: at ? assetRef(at.repo, at.branches[0], at.path) : assetRef(l.repo, l.branch, l.root + a.path),
      name: a.name,
      type: a.type,
      ...(a.size !== undefined ? { kb: Math.round(a.size / 1024) } : {}),
      ...(at ? { inBranches: (a as CatalogAsset).branchCount } : {}),
      ...(stats && l.budget ? { fitsBudget: !summaryIssues(stats, l.budget).length } : {})
    }
  }
  /** The asset a ref names: in the open branch, or among the indexed ones. */
  const assetOfRef = (ref: unknown) => {
    const at = parseAssetRef(ref)
    if (!at) throw new Error('Not an asset ref; use one returned by search_assets')
    const l = latest.current
    const here = at.repo === l.repo && at.branch === l.branch ? l.assets.find((a) => l.root + a.path === at.path) : undefined
    const indexed = here ? undefined : l.catalogAssets?.find((c) => c.locations.some((x) => x.repo === at.repo && x.path === at.path && x.branches.includes(at.branch)))
    return { ...at, asset: here ?? indexed, here: !!here }
  }
  /** Indexed assets of a repo (null: every repo), read without changing the view; kept for the session. */
  const aiCatalogs = useRef(new Map<string, Promise<CatalogAsset[]>>())
  const catalogFor = (repoName: string | null) => {
    const key = repoName ?? '*'
    let list = aiCatalogs.current.get(key)
    if (!list) {
      list = window.api.catalog.list(repoName, latest.current.excludedFolders).then(unwrap)
      list.catch(() => aiCatalogs.current.delete(key))
      aiCatalogs.current.set(key, list)
    }
    return list
  }
  /** The repo a name the user gave means: one full name, or why not. */
  const repoNamed = (named: unknown): { repo?: string; answer?: object } => {
    if (typeof named !== 'string' || !named.trim()) return {}
    const all = latest.current.repos.map((r) => r.fullName)
    const matches = matchRepos(all, named)
    if (!matches.length) return { answer: { error: `No repo matches "${named}"`, repos: all.slice(0, 30) } }
    if (matches.length > 1) return { answer: { ambiguous: `Several repos match "${named}"; offer them as choices`, repos: matches.slice(0, 6) } }
    return { repo: matches[0] }
  }

  useAiTools({
    name_words: async ({ type, where, repo: named }) => {
      const { repo: only, answer } = repoNamed(named)
      if (answer) return answer
      const l = latest.current
      const scopeRepo = only ?? (where === 'repo' ? l.repo : where === 'all' ? null : undefined)
      const pool: readonly Asset[] = scopeRepo === undefined ? l.assets : await catalogFor(scopeRepo)
      const tab = typeof type === 'string' && registry.get(type) ? type : ALL
      const words = new AssetSearch(tab === ALL ? pool : pool.filter((a) => l.inTab(a, tab))).words()
      return {
        scope: scopeRepo === undefined ? `${l.repo}@${l.branch}` : scopeRepo ?? 'every repo',
        assets: pool.length,
        // Most used first; capped so a huge repo stays readable.
        words: words.slice(0, 4000).map((w) => w.word).join(' ')
      }
    },
    search_assets: async ({ query: q, type, where, repo: named }) => {
      const words = String(q ?? '').trim()
      if (!words) throw new Error('Empty query')
      const tab = typeof type === 'string' && registry.get(type) && !registry.get(type)?.hidden ? type : ALL
      // A repo the user named: the hub opens it and searches every branch of it (one repo's index loads ~8× faster than all).
      const { repo: namedRepo, answer } = repoNamed(named)
      if (answer) return answer
      const only = namedRepo ?? ''
      if (only && only !== latest.current.repo) {
        setRepo(only)
        await waitFor(() => latest.current.repo === only, 5000)
      }
      const to: SearchScope = only ? 'repo' : where === 'repo' || where === 'all' ? where : 'branch'
      const wide = to !== 'branch'
      setOpenCollection(undefined)
      setFolder('')
      setScope(to)
      setTypeFilter(tab)
      setQuery(words)
      const loaded = await waitFor(() => {
        const l = latest.current
        // The repo view's index must be the open repo's, not the one shown before switching.
        const current = to !== 'repo' || !l.catalogAssets?.length || l.catalogAssets[0].locations.some((x) => x.repo === l.repo)
        return l.query === words && l.typeFilter === tab && (wide ? l.inCatalog && !!l.catalogAssets && current : !l.inCatalog && l.treeReady)
      })
      const items = latest.current.gridItems
      return {
        shownInHub: true,
        searched: to === 'all' ? 'every indexed repo and branch' : to === 'repo' ? `every branch of ${latest.current.repo}` : `${latest.current.repo}@${latest.current.branch}`,
        total: items.length,
        results: items.slice(0, 8).map(describeForAi),
        ...(loaded ? {} : { note: 'Still loading; results may be incomplete' })
      }
    },
    open_asset: async ({ ref }) => {
      const at = assetOfRef(ref)
      openLocation(at.repo, at.branch, at.path)
      return { opened: at.path.split('/').pop(), repo: at.repo, branch: at.branch }
    },
    asset_info: async ({ ref }) => {
      const at = assetOfRef(ref)
      const l = latest.current
      const stats = at.asset ? l.modelStats[at.asset.sha] : undefined
      const report = unwrap(await window.api.assets.resolve(at.repo, at.branch, at.path, projectRootOf(at.path), 'quick'))
      return {
        name: at.path.split('/').pop(),
        ...(at.asset ? { type: at.asset.type, ...(at.asset.size !== undefined ? { kb: Math.round(at.asset.size / 1024) } : {}) } : {}),
        measured: stats
          ? { triangles: stats.triangles, vertices: stats.vertices, materials: stats.materials, textureKB: Math.round(stats.textureBytes / 1024), maxTextureSize: stats.maxTextureSize, ...(stats.duration ? { seconds: stats.duration } : {}), ...(stats.clipLength ? { clipSeconds: stats.clipLength } : {}) }
          : 'not measured yet (opening it in the hub measures it)',
        ...(stats && l.budget ? { overBudget: summaryIssues(stats, l.budget).map((i) => `${i.key} ${i.value} > ${i.limit}`) } : {}),
        dependencies: {
          files: report.files.filter((f) => !f.endsWith('.meta')).length,
          materials: report.materials.length,
          ...(report.parts ? { parts: report.parts.slice(0, 10).map((p) => `${p.kind} ${p.name}${p.missing ? ' (missing)' : ''}`) } : {}),
          ...(report.particles ? { emitters: report.particles.length } : {}),
          warnings: report.warnings
        }
      }
    },
    add_to_chest: async ({ refs }) => {
      const added: string[] = []
      const skipped: string[] = []
      for (const ref of Array.isArray(refs) ? refs : []) {
        const at = assetOfRef(ref)
        if (!at.here || !at.asset) {
          skipped.push(`${at.path.split('/').pop()}: not in the open branch (open_asset it first)`)
          continue
        }
        const asset = at.asset
        setPack((items) => (items.some((i) => i.asset.id === asset.id) ? items : [...items, packItem(asset)]))
        flyToPack(asset.id)
        added.push(asset.name)
      }
      return { added, ...(skipped.length ? { skipped } : {}) }
    },
    add_to_collection: async ({ refs, collection }) => {
      const name = String(collection ?? '').trim()
      if (!name) throw new Error('No collection name')
      let list = withFavorites(latest.current.collections)
      const favourite = /^(favou?rites?|yêu thích|즐겨찾기)$/i.test(name)
      let id = favourite ? FAVORITES : list.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id
      if (!id) {
        id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        list = addCollection(list, id, name)
      }
      const added: string[] = []
      for (const ref of Array.isArray(refs) ? refs : []) {
        const at = assetOfRef(ref)
        if (!at.asset) continue
        const item: CollectionItem = { repo: at.repo, branch: at.branch, path: at.path, sha: at.asset.sha, name: at.asset.name, type: at.asset.type, ...(at.asset.size !== undefined ? { size: at.asset.size } : {}) }
        if (!inCollection(list.find((c) => c.id === id), item)) list = toggleItem(list, id, item)
        added.push(at.asset.name)
      }
      onCollections(list)
      return { collection: name, added }
    },
    offer_choices: async ({ options, other }) => offerChoices(options, other)
  })

  const rememberReport = (path: string, report: DependencyReport) => {
    reports.current.set(path, report)
    setPack((items) => items.map((i) => (i.path === path ? { ...i, report } : i)))
  }

  const saveStats = (key: string, summary: StatsSummary) => {
    // A thumbnail's measurement never replaces one taken in the viewer (which counts every texture).
    setModelStats((prev) => ({ ...prev, [key]: mergeStats(prev[key], summary) }))
    void window.api.stats.save(key, summary)
  }
  const saveThumb = (key: string, dataUrl: string, summary?: StatsSummary, motion?: string) => {
    setThumbs((prev) => ({ ...prev, [key]: dataUrl }))
    void window.api.thumbs.save(key, dataUrl)
    if (motion) void window.api.thumbs.save(motionKey(key), motion)
    // Drawn this session: not drawn again, even if it is still not up to date.
    unmeasuredPrefabs.current.add(key)
    if (summary) saveStats(key, summary)
  }
  /** The opened model is loading: thumbnails wait so it gets the bandwidth. */
  const [viewerLoading, setViewerLoading] = useState(false)
  const thumbQueue = useThumbnailQueue(live, saveThumb, viewerLoading)

  // Cards on screen go first; once the queue is empty the rest of the list follows, top first,
  // a few at a time so cards scrolled into view can still jump ahead.
  useEffect(() => {
    if (!thumbsLoaded || viewerLoading || thumbQueue.busy.size || (!inCatalog && !live)) return
    renderable
      // Models measured before clip names, or before .mat textures counted, get one more render for them.
      .filter((a) => (!thumbs[a.sha] || remeasure(a)) && !thumbQueue.failedRecently(a.sha))
      .slice(0, 4)
      .forEach((a, i) => {
        if (!modelStats[a.sha]) unmeasuredPrefabs.current.add(a.sha)
        requestThumb(a, 1_000_000 + i)
      })
  }, [thumbsLoaded, viewerLoading, thumbQueue.busy, thumbs, modelStats, gridItems, inCatalog, live])

  /** Counts for the type tabs: of the open branch, or of the cross-branch results. */
  const typeSource: readonly Asset[] = inCatalog ? (catalog.assets ?? []) : assets
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of typeSource) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    // Tabs that also list other types count them too.
    for (const h of registry.all()) if (h.alsoShows) counts.set(h.id, (counts.get(h.id) ?? 0) + typeSource.filter((a) => a.type !== h.id && inTab(a, h.id)).length)
    return counts
  }, [typeSource, registry, inTab])

  return (
    <div className="browse">
      <header className="topbar">
        <div className="brand" style={{ marginRight: 8 }}>
          <LogoMark size={34} />
          <span className="brand-name">Asset Hub</span>
          <VersionBadge />
        </div>
        <Picker
          label={t('browse.repo')}
          value={repo}
          options={repoNames}
          groupOf={ownerPrefix}
          ungroupedLabel=""
          placeholder={repos.status === 'loading' ? t('browse.loadingRepos') : t('browse.noRepos')}
          width={320}
          onChange={setRepo}
        />
        <Picker
          label={t('browse.branch')}
          value={branch}
          options={branches}
          groupOf={branchPrefix}
          ungroupedLabel={t('browse.branchNoPrefix')}
          tagOf={(b) => (b === defaultBranch ? t('browse.defaultBranch') : undefined)}
          placeholder={repo ? t('browse.loadingBranches') : '—'}
          width={220}
          onChange={setBranch}
        />
        {roots.length > 1 && (
          <div className="picker">
            <span className="muted small">{t('browse.project')}</span>
            <Dropdown value={root} options={roots.map((r) => ({ value: r, label: r || '/' }))} onChange={setRoot} label={t('browse.project')} />
          </div>
        )}
        <button
          type="button"
          className="btn icon-btn watch-btn"
          aria-pressed={watchingHere}
          aria-label={watchingHere ? t('watch.stop') : t('watch.start')}
          title={watchingHere ? t('watch.stop') : t('watch.start')}
          disabled={!branch || branchRepo !== repo}
          onClick={() => void toggleWatch()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={watchingHere ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" fill={watchingHere ? 'var(--panel)' : 'none'} />
          </svg>
        </button>
        <button
          type="button"
          className="btn icon-btn"
          aria-label={t('browse.refresh')}
          title={t('browse.refresh')}
          disabled={!branch || tree.status === 'loading'}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshIcon />
        </button>
        {/* Search and Settings move together: when the bar wraps, Settings stays at the right end. */}
        <div className="topbar-end">
          <SearchBox value={query} search={inCatalog ? catalogSearch : searcher} onChange={onQuery} />
          <button type="button" className="btn topbar-settings" aria-label={t('common.settings')} title={t('browse.settingsAccount')} onClick={onSettings}>
            <GearIcon />
            {login && <span className="small" title={login}>{displayName(login)}</span>}
          </button>
        </div>
      </header>


      <div
        className="browse-body"
        style={{ ...(detailsWidth ? { '--details-w': `${detailsWidth}px` } : {}), ...(viewerHeight ? { '--viewer-h': `${viewerHeight}px` } : {}) } as CSSProperties}
      >
        <aside className="sidebar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.types')}</span>
            <div className="tabs" role="group" aria-label={t('browse.types')}>
              <button type="button" className="tab" aria-pressed={typeFilter === ALL} onClick={() => { setTypeFilter(ALL); setOpenCollection(undefined) }}>
                <span className="type-gem" style={{ background: 'var(--text-2)' }} />
                {t('assetTypes.all')} <span className="muted">{typeSource.filter((a) => !registry.get(a.type)?.hidden).length}</span>
              </button>
              {registry.all().filter((h) => !h.hidden).map((h) => (
                <button key={h.id} type="button" className="tab" aria-pressed={typeFilter === h.id} onClick={() => { setTypeFilter(h.id); setOpenCollection(undefined) }}>
                  <span className="type-gem" style={{ background: `var(--type-${h.id})` }} />
                  {t(h.labelKey)} <span className="muted">{typeCounts.get(h.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <WatchNav watched={watched} news={news} current={{ repo, branch }} onOpen={openBranch} onRemove={(w) => onWatched(watched.filter((x) => x !== w))} />
          <RecentNav lists={recentLists} open={openCollection} onOpen={setOpenCollection} />
          <CollectionsNav
            collections={collections}
            open={openCollection}
            onOpen={setOpenCollection}
            onCreate={(id, name) => onCollections(addCollection(collections, id, name))}
          />
          <nav aria-label={t('browse.folders')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.folders')}</span>
            {/* Mount only once the branch is loaded so the initial expansion sees real folders. */}
            {!inCatalog && tree.status === 'ready' && (
              <FolderTree key={`${repo}@${branch}:${root}:${typeFilter}`} root={folderRoot} selected={folder} onSelect={(f) => { setFolder(f); setOpenCollection(undefined) }} />
            )}
          </nav>
          {!inCatalog && (
          <label className="check">
            <input type="checkbox" checked={mergeCopies} onChange={(e) => setMergeCopies(e.target.checked)} />
            {t('browse.mergeCopies')}
          </label>
          )}
          {!inCatalog && hiddenCount > 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              {t('browse.hidden', { count: hiddenCount, folders: excludedFolders.join(', ') })}
            </p>
          )}
        </aside>

        <main className="content">
          {shownCollection ? (
            <CollectionView
              collection={shownCollection}
              registry={registry}
              thumbs={thumbs}
              stats={modelStats}
              current={{ repo, branch, path: selected ? root + selected.path : undefined }}
              onOpenItem={(item) => openLocation(item.repo, item.branch, item.path)}
              onRename={(name) => onCollections(renameCollection(collections, shownCollection.id, name))}
              onDelete={() => {
                onCollections(deleteCollection(collections, shownCollection.id))
                setOpenCollection(undefined)
              }}
              onClose={() => setOpenCollection(undefined)}
            />
          ) : (
          <>
          <ScopeTabs scope={scope} onScope={setScope} />
          <div className="content-head">
            <h1>{inCatalog ? t(`catalog.title.${scope}`, { repo: repo.split('/').pop() }) : folder || t('browse.allFolders')}</h1>
            <span className="muted small">
              {inCatalog
                ? t('browse.assetCount', { count: rankedCatalog.length })
                : <>
                    {t('browse.assetCount', { count: rankedShown.length })}
                    {merged > 0 && ` · ${t('browse.merged', { count: merged })}`}
                    {unlistedCount > 0 && (
                      <>
                        {' · '}
                        <button type="button" className="inline-link" onClick={() => setShowUnlisted(true)}>
                          {t('browse.unlistedShow', { count: unlistedCount })}
                        </button>
                      </>
                    )}
                    {showUnlisted && unlistedKey && (
                      <>
                        {' · '}
                        <button type="button" className="inline-link" onClick={() => setShowUnlisted(false)}>
                          {t('browse.unlistedHide')}
                        </button>
                      </>
                    )}
                  </>}
              {renderable.length > 0 && (
                <span className="loaded-count" title={t('browse.loadedHint')}>
                  {' · '}
                  {t('browse.loaded', { done: loadedCount.toLocaleString(), total: renderable.length.toLocaleString() })}
                  {loadedCount < renderable.length && <progress className="loaded-bar" max={renderable.length} value={loadedCount} />}
                </span>
              )}
            </span>
          </div>
          {(inCatalog ? catalogShown.length : shown.length) > 0 && (
            <div className="ranking-bar">
              <Dropdown<SortMode>
                size="sm"
                value={sortMode}
                options={(['relevance', ...(budget ? (['playable'] as const) : []), 'smallest', 'triangles', ...(inCatalog ? (['used'] as const) : [])] as const).map((m) => ({ value: m, label: t(`ranking.sorts.${m}`) }))}
                onChange={setSortMode}
                label={t('ranking.sort')}
              />
              {budget && (
                <label className="check small">
                  <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />
                  {t('ranking.onlyFits')}
                </label>
              )}
              <Dropdown
                size="sm"
                value={budgetPreset}
                options={BUDGET_PRESETS.map((p) => ({ value: p, label: t(`budget.presets.${p}`) }))}
                onChange={onBudgetPreset}
                label={t('budget.preset')}
                title={t('budget.presetHint')}
              />
              <div className="chips" role="group" aria-label={t('chips.label')}>
                {QUICK_CHIPS.map((c) => (
                  <button key={c} type="button" className="chip" aria-pressed={chips.includes(c)} onClick={() => setChips((on) => (on.includes(c) ? on.filter((x) => x !== c) : [...on, c]))}>
                    {t(`chips.${c}`)}
                  </button>
                ))}
              </div>
              {chips.length > 0 && !gridItems.length && <span className="muted small">{t('chips.none')}</span>}
              {(sortMode !== 'relevance' || (onlyFits && budget) || chips.some((c) => c !== 'small')) && (
                <>
                  <span className="muted small">{t('ranking.measured', { done: measuredCount, total: inCatalog ? catalogShown.length : shown.length })}</span>
                  {unmeasured.some(canRender) && (
                    <button type="button" className="btn btn-small" onClick={measureAll}>
                      {t('ranking.measure', { count: unmeasured.filter(canRender).length })}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {inCatalog && catalog.assets && (
            <div className="catalog-filters">
              {scope === 'all' && (
                <Dropdown
                  size="sm"
                  className="filter-trigger"
                  value={catalogRepo}
                  options={[
                    { value: '', label: t('catalog.allRepos', { count: catalogFacets.repos.length }) },
                    ...catalogFacets.repos.map(([r, n]) => ({ value: r, label: r.split('/').pop() ?? r, hint: String(n) }))
                  ]}
                  onChange={(r) => (setCatalogRepo(r), setCatalogBranch(''))}
                  label={t('catalog.filterRepo')}
                />
              )}
              <Dropdown
                size="sm"
                className="filter-trigger"
                value={catalogBranch}
                options={[
                  { value: '', label: t('catalog.allBranches', { count: catalogFacets.branches.length }) },
                  ...catalogFacets.branches.map(([b, n]) => ({ value: b, label: b, hint: String(n) }))
                ]}
                onChange={setCatalogBranch}
                label={t('catalog.filterBranch')}
              />
            </div>
          )}
          {inCatalog && <CatalogStatusLine status={catalog.status} error={catalog.error} onPause={catalog.pause} onResume={catalog.resume} />}
          {(searchFound.related.length > 0 || searchFound.typos.length > 0) && (
            <p className="muted small" style={{ margin: '-8px 0 0' }}>
              {searchFound.related.length > 0 && t('search.related', { names: searchFound.related.slice(0, 8).join(', ') })}
              {searchFound.related.length > 0 && searchFound.typos.length > 0 && ' · '}
              {searchFound.typos.length > 0 && t('search.typos', { names: searchFound.typos.slice(0, 5).join(', ') })}
            </p>
          )}
          {inCatalog && !catalog.assets && !catalog.error && (
            <div className="grid">
              {Array.from({ length: 12 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}
          {inCatalog && catalog.assets && catalogShown.length === 0 && (
            <p className="empty">{catalog.status.state === 'running' ? t('catalog.emptyYet') : t('browse.noResults')}</p>
          )}
          {inCatalog && catalogShown.length > 0 && (
            <>
              <div className="grid">
                {rankedCatalog.slice(0, limit).map((a, i) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    handler={registry.get(a.type)}
                    thumb={thumbs[a.sha]}
                    selected={a.sha === catalogSel}
                    onSelect={() => setCatalogSel(a.sha)}
                    note={locationNote(a, scope, t)}
                    generating={thumbQueue.busy.has(a.sha)}
                    stats={modelStats[a.sha]}
                    onVisible={
                      thumbsLoaded && canRender(a)
                        ? (on) => {
                            if (!on) return thumbQueue.cancel(a.sha)
                            if (thumbs[a.sha] && modelStats[a.sha] && !staleEffect(a) && !staleClip(a) && !staleModel(a)) return
                            const src = catalogSource(a)
                            thumbQueue.request(a.sha, src.path, i, src.ctx, kindOf(a))
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
              {limit < rankedCatalog.length && <div ref={sentinel} className="grid-sentinel" />}
            </>
          )}
          {repos.status === 'error' && <ErrorNote error={repos.error} />}
          {repos.status === 'ready' && repoList.length === 0 && <p className="empty">{t('browse.noRepos')}</p>}
          {!inCatalog && tree.status === 'loading' && repo && (
            <>
              <p className="muted small" role="status" style={{ margin: 0 }}>
                {t('browse.loading')}
              </p>
              <div className="grid">
                {Array.from({ length: 12 }, (_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </>
          )}
          {!inCatalog && tree.status === 'error' && <ErrorNote error={tree.error} />}
          {scan && registry.get(typeFilter)?.facts === scan.kind && (
            <p className="muted small" role="status">
              {scan.status === 'error'
                ? t('scan.failed', { what: t(`scan.what.${scan.kind}`) })
                : scan.total
                  ? t('scan.reading', { what: t(`scan.what.${scan.kind}`), done: formatBytes(scan.done), total: formatBytes(scan.total) })
                  : t('scan.starting', { what: t(`scan.what.${scan.kind}`) })}
            </p>
          )}
          {!inCatalog && tree.status === 'ready' && visible.length === 0 && <p className="empty">{t('browse.noResults')}</p>}
          </>
          )}
          {(pack.length > 0 || exportState.status !== 'idle') && (
            <ExportBar
              items={pack}
              capacity={packCapacity(budgetPreset)}
              options={exportOptions}
              state={exportState}
              onOptions={(o) => {
                setSkipByName(o.skipByName)
                setReuseExisting(o.reuseExisting)
                setStripScripts(o.stripScripts)
                if (o.layout !== exportLayout) onExportLayout(o.layout)
              }}
              onExport={() => void runExport(pack)}
              onImportToUnity={(editor) => void runExport(pack, editor)}
              onRemove={(path) => setPack((items) => items.filter((i) => i.path !== path))}
              onClear={() => setPack([])}
              onDismiss={() => setExportState({ status: 'idle' })}
            />
          )}
          {!shownCollection && (
          <>
          {!inCatalog && tree.status === 'ready' && shown.length > 0 && (
            <>
              {newHere.size > 0 && (
                <div className="watch-banner" role="status">
                  <strong>{t('watch.banner', { count: newHere.size, more: news[watchKey(repo, branch)]?.more ? '+' : '' })}</strong>
                  <label className="check small">
                    <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
                    {t('watch.onlyNew')}
                  </label>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn btn-small" onClick={markSeen}>
                    {t('watch.seen')}
                  </button>
                </div>
              )}
              {picked.length > 1 && (
                <MultiBar
                  count={picked.length}
                  collections={collections}
                  busy={exportState.status === 'running'}
                  onChest={() => {
                    const add = pickedAssets.filter((a) => !pack.some((i) => i.asset.id === a.id))
                    setPack((items) => [...items, ...add.map(packItem)])
                    add.forEach((a) => flyToPack(a.id))
                  }}
                  onCollection={(id) => {
                    let list = withFavorites(collections)
                    for (const a of pickedAssets) if (!inCollection(list.find((c) => c.id === id), itemOf(a))) list = toggleItem(list, id, itemOf(a))
                    onCollections(list)
                  }}
                  onImportToUnity={(editor) => void runExport(pickedAssets.map(packItem), editor)}
                  onClear={() => setPicked([])}
                />
              )}
              <div className="grid">
                {rankedShown.slice(0, limit).map((a, i) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    handler={registry.get(a.type)}
                    thumb={thumbs[a.sha]}
                    generating={thumbQueue.busy.has(a.sha)}
                    copies={mergeCopies ? copiesBySha.get(a.sha)?.length : undefined}
                    selected={a.id === selectedId || (!!selected && mergeCopies && selected.sha === a.sha)}
                    onSelect={(how) => pickCard(a, how)}
                    picked={picked.length > 1 && picked.includes(a.id)}
                    fresh={newHere.has(root + a.path)}
                    starred={favorites.has(`${repo}\n${root + a.path}`)}
                    stats={modelStats[a.sha]}
                    onVisible={
                      live && thumbsLoaded && canRender(a)
                        ? (on) => {
                            if (!on) return thumbQueue.cancel(a.sha)
                            if (thumbs[a.sha] && modelStats[a.sha] && !staleEffect(a) && !staleClip(a) && !staleModel(a)) return
                            thumbQueue.request(a.sha, root + a.path, i, undefined, kindOf(a))
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
              {limit < rankedShown.length && <div ref={sentinel} className="grid-sentinel" />}
            </>
          )}
          </>
          )}
        </main>

        {/* The grid keeps at least 360 px; the sidebar is 220–260 px. */}
        <Splitter axis="x" target="next" min={300} max={() => window.innerWidth - 260 - 360} onResize={setDetailsWidth} label={t('details.resizePanel')} />
        {inCatalog ? (
          <CatalogDetails
            asset={catalogSelected}
            thumb={catalogSelected && thumbs[catalogSelected.sha]}
            stats={catalogSelected && modelStats[catalogSelected.sha]}
            delivery={catalogSelected && registry.get(catalogSelected.type)?.delivery}
            exporting={exportState.status === 'running'}
            onOpen={openLocation}
            onExport={(a) => void exportFromCatalog(a)}
            onImportToUnity={(a, editor) => void exportFromCatalog(a, editor)}
          />
        ) : (
        <AssetDetails
          onOpenLocation={openLocation}
          onViewerLoading={setViewerLoading}
          onModelStats={saveStats}
          asset={selected}
          handler={selected && registry.get(selected.type)}
          playClips={registry.get(typeFilter)?.preview.kind === 'animation'}
          models={modelPaths}
          live={live}
          onThumb={saveThumb}
          onReport={rememberReport}
          inPack={!!selected && pack.some((i) => i.asset.id === selected.id)}
          exporting={exportState.status === 'running'}
          onTogglePack={() => selected && togglePack(selected)}
          onExport={() => selected && void runExport([packItem(selected)])}
          onImportToUnity={(editor) => selected && void runExport([packItem(selected)], editor)}
          copies={selected ? copiesBySha.get(selected.sha) : undefined}
          onSelectCopy={setSelectedId}
          excludedFolders={excludedFolders}
          onPrefabFiles={(path, files) => prefabFiles.current.set(path, files)}
          collectionActions={
            live && selected ? (
              <CollectionButtons
                collections={collections}
                item={itemOf(selected)}
                onToggle={(id) => onCollections(toggleItem(collections, id, itemOf(selected)))}
                onCreate={(id, name) => onCollections(toggleItem(addCollection(collections, id, name), id, itemOf(selected)))}
              />
            ) : undefined
          }
          viewerResizer={<Splitter axis="y" target="prev" min={160} max={() => window.innerHeight - 220} onResize={setViewerHeight} label={t('details.resizeViewer')} />}
        />
        )}
      </div>
      {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
