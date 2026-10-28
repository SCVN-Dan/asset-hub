import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildFolderTree,
  findUnityProjectRoots,
  isInExcludedFolder,
  isInFolder,
  projectEntries,
  type Asset,
  type AssetSource,
  type DependencyReport,
  type HandlerRegistry,
  type RepoRef,
  type TreeEntry
} from '@core/index'
import type { Language } from '@shared/settings'
import { AssetCard, SkeletonCard } from '../components/AssetCard'
import { AssetDetails } from '../components/AssetDetails'
import { ExportBar, type ExportOptions, type ExportState, type PackItem } from '../components/ExportBar'
import { unwrap } from '../remoteSource'
import { useThumbnailQueue } from '../useThumbnailQueue'
import { Picker } from '../components/Picker'
import { ErrorNote } from '../components/ErrorNote'
import { FolderTree } from '../components/FolderTree'
import { CubeIcon, GearIcon, InfoIcon, RefreshIcon, SearchIcon } from '../components/Icons'
import { LangToggle } from '../components/LangToggle'

interface Props {
  source: AssetSource
  registry: HandlerRegistry
  language: Language
  excludedFolders: string[]
  /** Signed-in GitHub login, shown in the top bar. */
  login?: string
  /** Repo/branch to reopen when they still exist. */
  initialRepo?: string
  initialBranch?: string
  onOpenBranch(repo: string, branch: string): void
  onLanguage(language: Language): void
  onSettings(): void
}

const ALL = 'all'
/** Cards rendered per step while scrolling. */
const PAGE = 60
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** PNG preview for Unity's import dialog, from a cached thumbnail data URL. */
async function thumbToPng(dataUrl: string, size = 128): Promise<Uint8Array | undefined> {
  try {
    const img = new Image()
    img.src = dataUrl
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
  language,
  excludedFolders,
  login,
  initialRepo,
  initialBranch,
  onOpenBranch,
  onLanguage,
  onSettings
}: Props) {
  const { t } = useTranslation()
  const [repos, setRepos] = useState<Load<RepoRef[]>>({ status: 'loading' })
  const [repo, setRepo] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [tree, setTree] = useState<Load<TreeEntry[]>>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [root, setRoot] = useState('')
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [folder, setFolder] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [mergeCopies, setMergeCopies] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)
  const [pack, setPack] = useState<PackItem[]>([])
  const [exportOptions, setExportOptions] = useState<ExportOptions>({ layout: 'source', skipByName: false })
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const reports = useRef(new Map<string, DependencyReport>())

  useEffect(
    () => window.api.exporter.onProgress((progress) => setExportState((s) => (s.status === 'running' ? { status: 'running', progress } : s))),
    []
  )
  // A pack belongs to one repo + branch.
  useEffect(() => {
    setPack([])
    reports.current.clear()
  }, [repo, branch])

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
        const preferred = repoList.find((r) => r.fullName === repo)?.defaultBranch
        if (repo === initialRepo && initialBranch && list.includes(initialBranch)) setBranch(initialBranch)
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
    if (!repo || !branch) return
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
      },
      (error: unknown) => !cancelled && setTree({ status: 'error', error })
    )
    return () => {
      cancelled = true
    }
  }, [source, repo, branch, reloadKey])

  const roots = useMemo(() => (tree.status === 'ready' ? findUnityProjectRoots(tree.data) : []), [tree])
  const allAssets = useMemo(() => {
    if (tree.status !== 'ready') return []
    // Without a Unity project marker, show the repo as-is.
    const entries = roots.length ? projectEntries(tree.data, root) : tree.data
    return registry.collectAssets(entries)
  }, [tree, roots, root, registry])
  const assets = useMemo(() => allAssets.filter((a) => !isInExcludedFolder(a.path, excludedFolders)), [allAssets, excludedFolders])
  const hiddenCount = allAssets.length - assets.length
  const ofType = useMemo(() => (typeFilter === ALL ? assets : assets.filter((a) => a.type === typeFilter)), [assets, typeFilter])
  const folderRoot = useMemo(() => buildFolderTree(ofType), [ofType])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ofType.filter((a) => isInFolder(a.path, folder) && (!q || a.name.toLowerCase().includes(q)))
  }, [ofType, folder, query])
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

  useEffect(() => setLimit(PAGE), [shown])
  // Render more cards as the end of the grid scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown, limit])

  // Arrow keys move the selection through the grid (Up/Down jump a row).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey || !shown.length) return
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, .picker-pop, .viewer')) return
      const grid = document.querySelector('.grid')
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1
      const index = shown.findIndex((a) => a.id === selectedId)
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols
      const next = index < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, index + step))
      e.preventDefault()
      setSelectedId(shown[next].id)
      if (next >= limit) setLimit(next + PAGE)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, selectedId, limit])

  useEffect(() => {
    if (!selectedId) return
    const card = document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(selectedId)}"]`)
    card?.scrollIntoView({ block: 'nearest' })
    if (document.activeElement?.classList.contains('asset-card')) card?.focus({ preventScroll: true })
  }, [selectedId])
  const live = useMemo(() => (source.isDemo || !repo || !branch ? undefined : { repo, branch, root }), [source, repo, branch, root])

  // Thumbnails rendered earlier, keyed by the model's content hash.
  useEffect(() => {
    if (source.isDemo || !allAssets.length) return
    let cancelled = false
    void window.api.thumbs.get(allAssets.map((a) => a.sha)).then((found) => !cancelled && setThumbs(found))
    return () => {
      cancelled = true
    }
  }, [source, allAssets])

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
      const result = unwrap(await window.api.exporter.unityPackage({ ...live, paths: items.map((i) => i.path), ...exportOptions, previews, suggestedName }))
      setExportState(result.canceled ? { status: 'idle' } : { status: 'done', result })
    } catch (error) {
      setExportState({ status: 'error', error })
    }
  }

  const packItem = (asset: Asset): PackItem => ({ asset, path: root + asset.path, report: reports.current.get(root + asset.path) })
  const togglePack = (asset: Asset) =>
    setPack((items) => (items.some((i) => i.asset.id === asset.id) ? items.filter((i) => i.asset.id !== asset.id) : [...items, packItem(asset)]))
  const rememberReport = (path: string, report: DependencyReport) => {
    reports.current.set(path, report)
    setPack((items) => items.map((i) => (i.path === path ? { ...i, report } : i)))
  }

  const saveThumb = (key: string, dataUrl: string) => {
    setThumbs((prev) => ({ ...prev, [key]: dataUrl }))
    void window.api.thumbs.save(key, dataUrl)
  }
  const thumbQueue = useThumbnailQueue(live, saveThumb)

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of assets) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    return counts
  }, [assets])

  return (
    <div className="browse">
      <header className="topbar">
        <div className="brand" style={{ marginRight: 8 }}>
          <span style={{ color: 'var(--accent-text)' }}>
            <CubeIcon size={24} />
          </span>
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
          <label className="picker">
            <span className="muted small">{t('browse.project')}</span>
            <select className="select" value={root} onChange={(e) => setRoot(e.target.value)}>
              {roots.map((r) => (
                <option key={r} value={r}>
                  {r || '/'}
                </option>
              ))}
            </select>
          </label>
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
        <div className="search">
          <SearchIcon />
          <label htmlFor="q" className="sr-only">
            {t('browse.search')}
          </label>
          <input id="q" type="search" placeholder={t('browse.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <LangToggle value={language} onChange={onLanguage} />
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

      <div className="browse-body">
        <aside className="sidebar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.types')}</span>
            <div className="tabs" role="group" aria-label={t('browse.types')}>
              <button type="button" className="tab" aria-pressed={typeFilter === ALL} onClick={() => setTypeFilter(ALL)}>
                {t('assetTypes.all')} <span className="muted">{assets.length}</span>
              </button>
              {registry.all().map((h) => (
                <button key={h.id} type="button" className="tab" aria-pressed={typeFilter === h.id} onClick={() => setTypeFilter(h.id)}>
                  {t(h.labelKey)} <span className="muted">{typeCounts.get(h.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <nav aria-label={t('browse.folders')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label-caps">{t('browse.folders')}</span>
            {/* Mount only once the branch is loaded so the initial expansion sees real folders. */}
            {tree.status === 'ready' && (
              <FolderTree key={`${repo}@${branch}:${root}:${typeFilter}`} root={folderRoot} selected={folder} onSelect={setFolder} />
            )}
          </nav>
          <label className="check">
            <input type="checkbox" checked={mergeCopies} onChange={(e) => setMergeCopies(e.target.checked)} />
            {t('browse.mergeCopies')}
          </label>
          {hiddenCount > 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              {t('browse.hidden', { count: hiddenCount, folders: excludedFolders.join(', ') })}
            </p>
          )}
        </aside>

        <main className="content">
          <div className="content-head">
            <h1>{folder || t('browse.allFolders')}</h1>
            <span className="muted small">
              {t('browse.assetCount', { count: shown.length })}
              {merged > 0 && ` · ${t('browse.merged', { count: merged })}`}
            </span>
          </div>
          {repos.status === 'error' && <ErrorNote error={repos.error} />}
          {repos.status === 'ready' && repoList.length === 0 && <p className="empty">{t('browse.noRepos')}</p>}
          {tree.status === 'loading' && repo && (
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
          {tree.status === 'error' && <ErrorNote error={tree.error} />}
          {tree.status === 'ready' && visible.length === 0 && <p className="empty">{t('browse.noResults')}</p>}
          {(pack.length > 0 || exportState.status !== 'idle') && (
            <ExportBar
              items={pack}
              options={exportOptions}
              state={exportState}
              onOptions={setExportOptions}
              onExport={() => void runExport(pack)}
              onRemove={(path) => setPack((items) => items.filter((i) => i.path !== path))}
              onClear={() => setPack([])}
              onDismiss={() => setExportState({ status: 'idle' })}
            />
          )}
          {tree.status === 'ready' && shown.length > 0 && (
            <>
              <div className="grid">
                {shown.slice(0, limit).map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    handler={registry.get(a.type)}
                    thumb={thumbs[a.sha]}
                    generating={thumbQueue.busy.has(a.sha)}
                    copies={mergeCopies ? copiesBySha.get(a.sha)?.length : undefined}
                    selected={a.id === selectedId || (!!selected && mergeCopies && selected.sha === a.sha)}
                    onSelect={() => setSelectedId(a.id)}
                    onVisible={
                      live && registry.get(a.type)?.preview.kind === 'three'
                        ? (on) => (on ? !thumbs[a.sha] && thumbQueue.request(a.sha, root + a.path) : thumbQueue.cancel(a.sha))
                        : undefined
                    }
                  />
                ))}
              </div>
              {limit < shown.length && <div ref={sentinel} className="grid-sentinel" />}
            </>
          )}
        </main>

        <AssetDetails
          asset={selected}
          handler={selected && registry.get(selected.type)}
          live={live}
          onThumb={saveThumb}
          onReport={rememberReport}
          inPack={!!selected && pack.some((i) => i.asset.id === selected.id)}
          exporting={exportState.status === 'running'}
          onTogglePack={() => selected && togglePack(selected)}
          onExport={() => selected && void runExport([packItem(selected)])}
          copies={selected ? copiesBySha.get(selected.sha) : undefined}
          onSelectCopy={setSelectedId}
        />
      </div>
    </div>
  )
}
