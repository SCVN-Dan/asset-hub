import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
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
import { GearIcon, InfoIcon, RefreshIcon } from '../components/Icons'
import { LogoMark } from '../components/Logo'
import { flyToPack } from '../motion'
import { SearchBox } from '../components/SearchBox'
import { DRAWABLE } from '../viewer/formats'
import { CatalogDetails, CatalogStatusLine, locationNote, ScopeTabs } from '../components/CatalogPanel'
import { useCatalog, type SearchScope } from '../useCatalog'
import { BUDGET_PRESETS, mergeStats, rankForPlayable, summaryIssues, type BudgetPreset, type SortMode, type StatsSummary } from '@core/checks/playable'
import { useBudget } from '../budget'
import { parseAssetLink } from '@shared/deeplink'
import { FX_THUMB_VERSION, motionKey } from '../viewer/particleThumb'
import { ANIM_THUMB_VERSION, MODEL_THUMB_VERSION } from '../viewer/thumbVersions'
import { useSharedImports } from '../useSharedIndex'
import { Splitter, useStoredSize } from '../components/Splitter'

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
  targetProject
}: Props) {
  const { t } = useTranslation()
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
  const exportOptions: ExportOptions = { layout: exportLayout, skipByName, targetProject, reuseExisting }
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
        if (nav.current?.repo === repo && nav.current.branch === branch) land(entries, nav.current.path)
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

  const catalog = useCatalog(scope, repo, branch, excludedFolders, !source.isDemo)
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
  const rankedShown = useMemo(
    () => rankForPlayable(
        onlyFits && budget ? shown.filter((a) => modelStats[a.sha] && !summaryIssues(modelStats[a.sha], budget).length) : shown,
        sortMode === 'used' || (sortMode === 'playable' && !budget) ? 'relevance' : sortMode,
        (a) => modelStats[a.sha],
        undefined,
        (a) => found.scores.get(a.id) ?? 0,
        budget
      ),
    [shown, sortMode, onlyFits, modelStats, found, budget]
  )
  const rankedCatalog = useMemo(
    () =>
      rankForPlayable(
        onlyFits && budget ? catalogShown.filter((a) => modelStats[a.sha] && !summaryIssues(modelStats[a.sha], budget).length) : catalogShown,
        sortMode === 'playable' && !budget ? 'relevance' : sortMode,
        (a) => modelStats[a.sha],
        (a) => a.branchCount,
        (a) => catalogFound.scores.get(a.id) ?? 0,
        budget
      ),
    [catalogShown, sortMode, onlyFits, modelStats, catalogFound, budget]
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
  const exportFromCatalog = async (a: CatalogAsset) => {
    const at = a.locations[0]
    setExportState({ status: 'running' })
    const thumb = thumbs[a.sha]
    const png = thumb ? await thumbToPng(thumb) : undefined
    try {
      const result = unwrap(
        await window.api.exporter.unityPackage({
          repo: at.repo,
          branch: at.branches[0],
          root: projectRootOf(at.path),
          paths: [at.path],
          ...exportOptions,
          extraFiles: [],
          previews: png ? { [at.path]: png } : {},
          suggestedName: a.name.replace(/\.[^.]+$/, '')
        })
      )
      setExportState(result.canceled ? { status: 'idle' } : { status: 'done', result })
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
    if (!link) return setQuery(q)
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
  const live = useMemo(
    () => (source.isDemo || !repo || !branch || branchRepo !== repo ? undefined : { repo, branch, root }),
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
  // Thumbnails rendered earlier, keyed by the model's content hash.
  useEffect(() => {
    setThumbsLoaded(false)
    if (source.isDemo || !allAssets.length) return
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

  const runExport = async (items: PackItem[]) => {
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
      const result = unwrap(await window.api.exporter.unityPackage({ ...live, paths: items.map((i) => i.path), ...exportOptions, extraFiles: items.flatMap((i) => prefabFiles.current.get(i.path) ?? []), previews, suggestedName }))
      setExportState(result.canceled ? { status: 'idle' } : { status: 'done', result })
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
          className="btn icon-btn"
          aria-label={t('browse.refresh')}
          title={t('browse.refresh')}
          disabled={!branch || tree.status === 'loading'}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshIcon />
        </button>
        <SearchBox value={query} search={inCatalog ? catalogSearch : searcher} onChange={onQuery} />
        <button type="button" className="btn" aria-label={t('common.settings')} title={t('common.settings')} onClick={onSettings}>
          <GearIcon />
          {login && <span className="small">{login}</span>}
        </button>
      </header>

      {source.isDemo && (
        <div className="banner" role="status">
          <InfoIcon />
          {t('browse.demoBanner')}
        </div>
      )}

      <div
        className="browse-body"
        style={{ ...(detailsWidth ? { '--details-w': `${detailsWidth}px` } : {}), ...(viewerHeight ? { '--viewer-h': `${viewerHeight}px` } : {}) } as CSSProperties}
      >
        <aside className="sidebar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.types')}</span>
            <div className="tabs" role="group" aria-label={t('browse.types')}>
              <button type="button" className="tab" aria-pressed={typeFilter === ALL} onClick={() => setTypeFilter(ALL)}>
                <span className="type-gem" style={{ background: 'var(--text-2)' }} />
                {t('assetTypes.all')} <span className="muted">{typeSource.filter((a) => !registry.get(a.type)?.hidden).length}</span>
              </button>
              {registry.all().filter((h) => !h.hidden).map((h) => (
                <button key={h.id} type="button" className="tab" aria-pressed={typeFilter === h.id} onClick={() => setTypeFilter(h.id)}>
                  <span className="type-gem" style={{ background: `var(--type-${h.id})` }} />
                  {t(h.labelKey)} <span className="muted">{typeCounts.get(h.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <nav aria-label={t('browse.folders')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.folders')}</span>
            {/* Mount only once the branch is loaded so the initial expansion sees real folders. */}
            {inCatalog && <p className="muted small" style={{ margin: 0 }}>{t('catalog.foldersBranchOnly')}</p>}
            {!inCatalog && tree.status === 'ready' && (
              <FolderTree key={`${repo}@${branch}:${root}:${typeFilter}`} root={folderRoot} selected={folder} onSelect={setFolder} />
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
          {!source.isDemo && <ScopeTabs scope={scope} onScope={setScope} />}
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
              {(sortMode !== 'relevance' || (onlyFits && budget)) && (
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
          {(pack.length > 0 || exportState.status !== 'idle') && (
            <ExportBar
              items={pack}
              capacity={packCapacity(budgetPreset)}
              options={exportOptions}
              state={exportState}
              onOptions={(o) => {
                setSkipByName(o.skipByName)
                setReuseExisting(o.reuseExisting)
                if (o.layout !== exportLayout) onExportLayout(o.layout)
              }}
              onExport={() => void runExport(pack)}
              onRemove={(path) => setPack((items) => items.filter((i) => i.path !== path))}
              onClear={() => setPack([])}
              onDismiss={() => setExportState({ status: 'idle' })}
            />
          )}
          {!inCatalog && tree.status === 'ready' && shown.length > 0 && (
            <>
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
                    onSelect={() => setSelectedId(a.id)}
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
          copies={selected ? copiesBySha.get(selected.sha) : undefined}
          onSelectCopy={setSelectedId}
          excludedFolders={excludedFolders}
          onPrefabFiles={(path, files) => prefabFiles.current.set(path, files)}
          viewerResizer={<Splitter axis="y" target="prev" min={160} max={() => window.innerHeight - 220} onResize={setViewerHeight} label={t('details.resizeViewer')} />}
        />
        )}
      </div>
    </div>
  )
}
