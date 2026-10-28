import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkPlayableBudget, type ModelStats } from '@core/checks/playable'
import { formatBytes, shortPath, type Asset, type AssetTypeHandler, type CatalogLocation, type DependencyReport, type MaterialRef, type PrefabMaterialsResult, type TextureRef } from '@core/index'
import { RemoteError, unwrap } from '../remoteSource'
import { LocationList } from './CatalogPanel'
import { ErrorNote } from './ErrorNote'
import { CubeIcon } from './Icons'
import { ModelViewer, type LiveContext } from './ModelViewer'

interface Props {
  asset: Asset | undefined
  handler: AssetTypeHandler | undefined
  /** Repo context; absent with sample data, where nothing can be downloaded. */
  live?: LiveContext
  onThumb(key: string, dataUrl: string): void
  /** Called once dependencies are known, so the pack can show sizes and warnings. */
  onReport(path: string, report: DependencyReport): void
  inPack: boolean
  exporting: boolean
  onTogglePack(): void
  onExport(): void
  /** Byte-identical copies of this file, including itself. */
  copies?: Asset[]
  onSelectCopy(id: string): void
  /** Folders left out of prefab searches, like the grid. */
  excludedFolders: string[]
  /** Extra files (prefab materials) to include when this model is exported. */
  onPrefabFiles(path: string, files: string[]): void
  /** Opens the same file in another branch or repo. */
  onOpenLocation(repo: string, branch: string, path: string): void
  onViewerLoading?(loading: boolean): void
}

type PrefabSearch = { status: 'idle' } | { status: 'running'; scope: 'near' | 'all' } | { status: 'ready'; result: PrefabMaterialsResult } | { status: 'error'; error: unknown }

type Deps = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; report: DependencyReport }

function Dot({ tone }: { tone: 'ok' | 'warn' | 'info' }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}

/** Stat cells worth showing: counts that are zero (no bones, no clips) or trivial (one mesh) are left out. */
function statCells(stats: ModelStats): Array<[string, string | number]> {
  const textureBytes = stats.textures.reduce((s, x) => s + x.bytes, 0)
  const cells: Array<[string, string | number | false]> = [
    ['triangles', stats.triangles.toLocaleString()],
    ['vertices', stats.vertices.toLocaleString()],
    ['meshes', stats.meshes > 1 && stats.meshes],
    ['materials', stats.materials > 0 && stats.materials],
    ['bones', stats.bones > 0 && stats.bones],
    ['clips', stats.animations.length > 0 && stats.animations.length],
    ['file', formatBytes(stats.fileBytes)],
    ['textures', textureBytes > 0 && formatBytes(textureBytes)]
  ]
  return cells.filter((c): c is [string, string | number] => c[1] !== false)
}

function MaterialRows({ m }: { m: MaterialRef }) {
  const { t } = useTranslation()
  return (
    <li>
      <div className="dep-row" title={m.path}>
        <Dot tone={m.missing ? 'warn' : 'ok'} />
        <span className="dep-type">MAT</span>
        <span className="dep-name">{m.name}</span>
        <span className="dep-meta">{m.missing ? t('deps.missing') : ''}</span>
      </div>
      {/* Built-in and package shaders come with Unity: nothing to do, so not listed. */}
      {m.shader?.kind === 'project' && (
        <div className="dep-row dep-child" title={m.shader.path ?? m.shader.guid}>
          <Dot tone={m.shader.kind === 'project' ? 'info' : 'ok'} />
          <span className="dep-type">SHD</span>
          <span className="dep-name">{m.shader.label}</span>
          <span className="dep-meta">{t('deps.shader.project')}</span>
        </div>
      )}
      <ul>
        {mergeSlots(m.textures).map((tex) => (
          <TextureRow key={`${tex.prop}:${tex.guid}`} tex={tex} />
        ))}
      </ul>
    </li>
  )
}

/** One row per texture: a file used by several slots (_MainTex, _OcclusionMap) is listed once. */
function mergeSlots(textures: readonly TextureRef[]): TextureRef[] {
  const byFile = new Map<string, TextureRef>()
  for (const tex of textures) {
    const key = tex.path ?? `${tex.prop}:${tex.name}`
    const seen = byFile.get(key)
    if (!seen) byFile.set(key, tex)
    else if (tex.prop && !seen.prop?.split(', ').includes(tex.prop)) byFile.set(key, { ...seen, prop: seen.prop ? `${seen.prop}, ${tex.prop}` : tex.prop })
  }
  return [...byFile.values()]
}

function TextureRow({ tex }: { tex: TextureRef }) {
  const { t } = useTranslation()
  const tone = tex.missing ? 'warn' : tex.matchedBy === 'name' ? 'info' : 'ok'
  return (
    <li className="dep-row dep-child" title={tex.path}>
      <Dot tone={tone} />
      <span className="dep-type">TEX</span>
      <span className="dep-name">
        {tex.prop && tex.prop !== tex.name && <span className="muted">{tex.prop} · </span>}
        {tex.missing ? tex.name : tex.path!.split('/').pop()}
      </span>
      <span className="dep-meta">{tex.missing ? t('deps.missing') : tex.matchedBy === 'name' ? t('deps.byName') : formatBytes(tex.size)}</span>
    </li>
  )
}

export function AssetDetails({ asset, handler, live, onThumb, onReport, inPack, exporting, onTogglePack, onExport, copies, onSelectCopy, excludedFolders, onPrefabFiles, onOpenLocation, onViewerLoading }: Props) {
  const { t } = useTranslation()
  const [deps, setDeps] = useState<Deps>({ status: 'idle' })
  const [stats, setStats] = useState<ModelStats>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [copied, setCopied] = useState(false)
  const [prefab, setPrefab] = useState<PrefabSearch>({ status: 'idle' })
  /** A suggested .mat (next to the FBX) the user chose to try. */
  const [picked, setPicked] = useState<{ material: MaterialRef; files: string[] }>()
  /** Other branches / repos with this exact file, from the catalog (empty until they are indexed). */
  const [elsewhere, setElsewhere] = useState<CatalogLocation[]>([])
  const [prefabProgress, setPrefabProgress] = useState<{ done: number; total: number }>()
  const repoPath = asset && live ? live.root + asset.path : undefined
  /** Bumped when the selection changes, so a search started for another model is ignored. */
  const searchToken = useRef(0)

  useEffect(() => {
    setElsewhere([])
    if (!live || !asset) return
    let cancelled = false
    void window.api.catalog.whereIs(asset.sha).then((r) => {
      if (cancelled || !r.ok) return
      // Leave out the branch being viewed.
      const others = r.data
        .map((l) => (l.repo === live.repo ? { ...l, branches: l.branches.filter((b) => b !== live.branch) } : l))
        .filter((l) => l.branches.length)
      setElsewhere(others)
    })
    return () => {
      cancelled = true
    }
  }, [live?.repo, live?.branch, asset?.sha])

  useEffect(() => window.api.assets.onIndexProgress(setProgress), [])
  useEffect(() => window.api.assets.onPrefabProgress(setPrefabProgress), [])

  useEffect(() => {
    searchToken.current++
    setStats(undefined)
    setCopied(false)
    setProgress(undefined)
    setPrefab({ status: 'idle' })
    setPicked(undefined)
    if (!live || !repoPath || !handler?.resolveDependencies) {
      setDeps({ status: 'idle' })
      return
    }
    let cancelled = false
    setDeps({ status: 'loading' })
    // Materials found on prefabs in an earlier search come back without downloading anything.
    void window.api.assets.findPrefabMaterials(live.repo, live.branch, repoPath, live.root, 'cached', excludedFolders).then((result) => {
      if (cancelled || !result.ok || !result.data.prefabs.length) return
      setPrefab({ status: 'ready', result: result.data })
      onPrefabFiles(repoPath, result.data.files)
    })
    window.api.assets.resolve(live.repo, live.branch, repoPath, live.root).then(
      (result) => {
        if (cancelled) return
        try {
          const report = unwrap(result)
          setDeps({ status: 'ready', report })
          onReport(repoPath, report)
        } catch (error) {
          setDeps({ status: 'error', error })
        }
      },
      (error: unknown) => !cancelled && setDeps({ status: 'error', error: new RemoteError({ code: 'unknown', message: String(error) }) })
    )
    return () => {
      cancelled = true
    }
  }, [live?.repo, live?.branch, live?.root, repoPath, handler])

  if (!asset) {
    return (
      <aside className="details" aria-label={t('details.label')}>
        <p className="empty">{t('details.empty')}</p>
      </aside>
    )
  }

  const report = deps.status === 'ready' ? deps.report : undefined
  const prefabResult = prefab.status === 'ready' ? prefab.result : undefined
  const prefabMaterial = prefabResult?.prefabs[0]?.materials.find((m) => !m.missing) ?? picked?.material
  const suggestions = !prefabResult?.prefabs.length ? (report?.suggested ?? []) : []

  const pick = (s: { material: MaterialRef; files: string[] } | undefined) => {
    setPicked(s)
    if (repoPath) onPrefabFiles(repoPath, s?.files ?? [])
  }

  const searchPrefabs = async (scope: 'near' | 'all') => {
    if (!live || !repoPath) return
    const token = ++searchToken.current
    setPrefab({ status: 'running', scope })
    setPrefabProgress(undefined)
    try {
      const result = unwrap(await window.api.assets.findPrefabMaterials(live.repo, live.branch, repoPath, live.root, scope, excludedFolders))
      if (token !== searchToken.current) return
      setPrefab({ status: 'ready', result })
      onPrefabFiles(repoPath, result.files)
    } catch (error) {
      if (token === searchToken.current) setPrefab({ status: 'error', error })
    }
  }
  const issues = stats ? checkPlayableBudget(stats) : []
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(asset.path)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside className="details" aria-label={t('details.label')}>
      {live && repoPath && handler?.preview.kind === 'three' ? (
        <ModelViewer
          key={repoPath}
          live={live}
          path={repoPath}
          report={report}
          prefabMaterial={prefabMaterial}
          onStats={setStats}
          onThumb={(url) => onThumb(asset.sha, url)}
          onLoading={onViewerLoading}
        />
      ) : (
        <div className="preview-box">
          <CubeIcon size={72} />
          <span>{t('viewer.needsRepo')}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>{asset.name}</h2>
        {live && handler?.resolveDependencies && (
          <div className="field-row">
            <button type="button" className="btn btn-primary" onClick={onExport} disabled={exporting}>
              {t('export.exportOne')}
            </button>
            <button type="button" className="btn" aria-pressed={inPack} onClick={onTogglePack} disabled={exporting}>
              {inPack ? t('export.inPack') : t('export.addToPack')}
            </button>
          </div>
        )}
      </div>

      {stats && (
        <section className="section">
          <span className="label-caps">{t('stats.title')}</span>
          <dl className="stat-grid">
            {statCells(stats).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`stats.${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {issues.length > 0 && (
            <ul className="warn-note warn-list">
              {issues.map((i) => (
                <li key={i.key}>
                  {t(`budget.${i.key}`, {
                    value: i.key.endsWith('Bytes') ? formatBytes(i.value) : i.value.toLocaleString(),
                    limit: i.key.endsWith('Bytes') ? formatBytes(i.limit) : i.limit.toLocaleString()
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {handler?.resolveDependencies && (
        <section className="section">
          <span className="label-caps">{t('details.deps')}</span>
          {!live && <p className="note">{t('deps.needsRepo')}</p>}
          {deps.status === 'loading' && (
            <div className="note">
              {progress && progress.total > 0 && progress.done < progress.total ? (
                <>
                  {t('deps.indexing', { done: progress.done.toLocaleString(), total: progress.total.toLocaleString() })}
                  <progress className="progress" max={progress.total} value={progress.done} />
                </>
              ) : (
                t('deps.resolving')
              )}
            </div>
          )}
          {deps.status === 'error' && <ErrorNote error={deps.error} />}
          {report && (
            <>
              {report.warnings
                // Missing files already say "not in repo" on their own row.
                .filter((w) => w !== 'missingTexture' && w !== 'missingMaterial')
                .filter((w) => w !== 'textureByName' || report.embeddedTextures.some((x) => !x.missing))
                .map((w) => (
                  <p key={w} className={w === 'textureByName' ? 'note' : 'warn-note'}>
                    {t(`deps.warning.${w}`)}
                  </p>
                ))}
              <ul className="dep-list">
                {report.materials.map((m) => (
                  <MaterialRows key={m.guid ?? m.name} m={m} />
                ))}
                {report.embeddedTextures.length > 0 && (
                  <li>
                    <div className="dep-row">
                      <Dot tone="info" />
                      <span className="dep-type">FBX</span>
                      <span className="dep-name">{t('deps.embedded')}</span>
                      <span className="dep-meta" />
                    </div>
                    <ul>
                      {report.embeddedTextures.map((tex) => (
                        <TextureRow key={tex.name} tex={tex} />
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
              {suggestions.length > 0 && (
                <div className="section" style={{ marginTop: 4 }}>
                  <p className="note">{t('deps.suggestedHint')}</p>
                  <ul className="dep-list">
                    {suggestions.map((s) => (
                      <li key={s.material.path}>
                        <div className="dep-row" title={s.material.path}>
                          <Dot tone="info" />
                          <span className="dep-type">MAT</span>
                          <span className="dep-name">{s.material.name}</span>
                          <button
                            type="button"
                            className="btn btn-small"
                            aria-pressed={picked?.material.path === s.material.path}
                            onClick={() => pick(picked?.material.path === s.material.path ? undefined : s)}
                          >
                            {picked?.material.path === s.material.path ? t('deps.suggestedOn') : t('deps.suggestedUse')}
                          </button>
                        </div>
                        <ul className="dep-indent">
                          {s.material.textures.map((tex) => (
                            <TextureRow key={`${tex.prop}:${tex.guid}`} tex={tex} />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {live && report && (
        <section className="section">
          <span className="label-caps">{t('prefab.title')}</span>
          {prefab.status === 'idle' && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                {t('prefab.hint')}
              </p>
              <div>
                <button type="button" className="btn" onClick={() => void searchPrefabs('near')}>
                  {t('prefab.search')}
                </button>
              </div>
            </>
          )}
          {prefab.status === 'running' && (
            <div className="note">
              {t(prefab.scope === 'all' ? 'prefab.scanningAll' : 'prefab.scanning')}
              {prefabProgress && prefabProgress.total > 0 && (
                <>
                  {' '}
                  {formatBytes(prefabProgress.done)} / {formatBytes(prefabProgress.total)}
                  <progress className="progress" max={prefabProgress.total} value={prefabProgress.done} />
                </>
              )}
            </div>
          )}
          {prefab.status === 'error' && <ErrorNote error={prefab.error} />}
          {prefabResult && (
            <>
              {prefabResult.prefabs.length === 0 ? (
                <p className="note">{t('prefab.none', { count: prefabResult.scanned })}</p>
              ) : (
                <>
                  <p className="note">{t('prefab.found', { count: prefabResult.prefabs.length })}</p>
                  <ul className="dep-list">
                    {prefabResult.prefabs.map((p) => (
                      <li key={p.path}>
                        <div className="dep-row" title={p.path}>
                          <Dot tone="ok" />
                          <span className="dep-type">PFB</span>
                          <span className="dep-name">{p.path.split('/').pop()}</span>
                          <span className="dep-meta" />
                        </div>
                        <ul className="dep-indent">
                          {p.materials.map((m) => (
                            <MaterialRows key={m.guid ?? m.name} m={m} />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {/* Only worth saying when there was a choice. */}
                  {prefabMaterial && prefabResult.prefabs.flatMap((p) => p.materials).length > 1 && (
                    <p className="muted small" style={{ margin: 0 }}>
                      {t('prefab.applied', { name: prefabMaterial.name })}
                    </p>
                  )}
                </>
              )}
              {prefabResult.remaining > 0 && (
                <div>
                  <button type="button" className={prefabResult.prefabs.length ? 'btn btn-small' : 'btn'} onClick={() => void searchPrefabs('all')}>
                    {t('prefab.scanAll', { count: prefabResult.remaining, size: formatBytes(prefabResult.remainingBytes) })}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {copies && copies.length > 1 && (
        <section className="section">
          <span className="label-caps">{t('details.copies', { count: copies.length })}</span>
          <ul className="copy-list">
            {copies.map((c) => (
              <li key={c.id}>
                <button type="button" className="copy-item" aria-current={c.id === asset.id} onClick={() => onSelectCopy(c.id)} title={c.path}>
                  {shortPath(c.path)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="section">
          <span className="label-caps">{t('catalog.alsoIn', { count: new Set(elsewhere.flatMap((l) => l.branches.map((b) => `${l.repo}@${b}`))).size })}</span>
          <LocationList locations={elsewhere} showRepo={elsewhere.some((l) => l.repo !== live?.repo)} onOpen={onOpenLocation} />
        </section>
      )}

      <div className="path-row">
        <span className="mono small" title={asset.path}>
          {shortPath(asset.path)}
        </span>
        <button type="button" className="btn btn-small" onClick={copyPath}>
          {copied ? t('details.copied') : t('details.copyPath')}
        </button>
      </div>
    </aside>
  )
}
