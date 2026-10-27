import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkPlayableBudget, type ModelStats } from '@core/checks/playable'
import { formatBytes, type Asset, type AssetTypeHandler, type DependencyReport, type TextureRef } from '@core/index'
import { RemoteError, unwrap } from '../remoteSource'
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
}

type Deps = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; report: DependencyReport }

function Dot({ tone }: { tone: 'ok' | 'warn' | 'info' }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}

function TextureRow({ tex }: { tex: TextureRef }) {
  const { t } = useTranslation()
  const tone = tex.missing ? 'warn' : tex.matchedBy === 'name' ? 'info' : 'ok'
  return (
    <li className="dep-row dep-child" title={tex.path}>
      <Dot tone={tone} />
      <span className="dep-type">TEX</span>
      <span className="dep-name">
        {tex.prop && <span className="muted">{tex.prop} · </span>}
        {tex.missing ? tex.name : tex.path!.split('/').pop()}
      </span>
      <span className="dep-meta">{tex.missing ? t('deps.missing') : tex.matchedBy === 'name' ? t('deps.byName') : formatBytes(tex.size)}</span>
    </li>
  )
}

export function AssetDetails({ asset, handler, live, onThumb, onReport, inPack, exporting, onTogglePack, onExport }: Props) {
  const { t } = useTranslation()
  const [deps, setDeps] = useState<Deps>({ status: 'idle' })
  const [stats, setStats] = useState<ModelStats>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [copied, setCopied] = useState(false)
  const repoPath = asset && live ? live.root + asset.path : undefined

  useEffect(() => window.api.assets.onIndexProgress(setProgress), [])

  useEffect(() => {
    setStats(undefined)
    setCopied(false)
    setProgress(undefined)
    if (!live || !repoPath || !handler?.resolveDependencies) {
      setDeps({ status: 'idle' })
      return
    }
    let cancelled = false
    setDeps({ status: 'loading' })
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
        <ModelViewer key={repoPath} live={live} path={repoPath} report={report} onStats={setStats} onThumb={(url) => onThumb(asset.sha, url)} />
      ) : (
        <div className="preview-box">
          <CubeIcon size={72} />
          <span>{t('viewer.needsRepo')}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>{asset.name}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {handler && <span className="badge badge-accent">{t(handler.labelKey)}</span>}
          {report && <span className="badge">{t(`deps.kind.${report.kind}`)}</span>}
          {asset.lfs && <span className="badge">LFS</span>}
        </div>
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
            <div>
              <dt>{t('stats.triangles')}</dt>
              <dd>{stats.triangles.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('stats.vertices')}</dt>
              <dd>{stats.vertices.toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('stats.meshes')}</dt>
              <dd>{stats.meshes}</dd>
            </div>
            <div>
              <dt>{t('stats.materials')}</dt>
              <dd>{stats.materials}</dd>
            </div>
            <div>
              <dt>{t('stats.bones')}</dt>
              <dd>{stats.bones}</dd>
            </div>
            <div>
              <dt>{t('stats.clips')}</dt>
              <dd>{stats.animations.length}</dd>
            </div>
            <div>
              <dt>{t('stats.file')}</dt>
              <dd>{formatBytes(stats.fileBytes)}</dd>
            </div>
            <div>
              <dt>{t('stats.textures')}</dt>
              <dd>{formatBytes(stats.textures.reduce((s, x) => s + x.bytes, 0))}</dd>
            </div>
          </dl>
          {issues.map((i) => (
            <p key={i.key} className="warn-note">
              {t(`budget.${i.key}`, {
                value: i.key.endsWith('Bytes') ? formatBytes(i.value) : i.value.toLocaleString(),
                limit: i.key.endsWith('Bytes') ? formatBytes(i.limit) : i.limit.toLocaleString()
              })}
            </p>
          ))}
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
                .filter((w) => w !== 'textureByName' || report.embeddedTextures.some((x) => !x.missing))
                .map((w) => (
                  <p key={w} className={w === 'textureByName' ? 'note' : 'warn-note'}>
                    {t(`deps.warning.${w}`)}
                  </p>
                ))}
              <ul className="dep-list">
                {report.materials.map((m) => (
                  <li key={m.guid ?? m.name}>
                    <div className="dep-row" title={m.path}>
                      <Dot tone={m.missing ? 'warn' : 'ok'} />
                      <span className="dep-type">MAT</span>
                      <span className="dep-name">{m.name}</span>
                      <span className="dep-meta">{m.missing ? t('deps.missing') : ''}</span>
                    </div>
                    {m.shader && (
                      <div className="dep-row dep-child" title={m.shader.path ?? m.shader.guid}>
                        <Dot tone={m.shader.kind === 'project' ? 'info' : 'ok'} />
                        <span className="dep-type">SHD</span>
                        <span className="dep-name">{m.shader.label}</span>
                        <span className="dep-meta">{t(`deps.shader.${m.shader.kind}`)}</span>
                      </div>
                    )}
                    <ul>
                      {m.textures.map((tex) => (
                        <TextureRow key={`${tex.prop}:${tex.guid}`} tex={tex} />
                      ))}
                    </ul>
                  </li>
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
              <p className="muted small" style={{ margin: 0 }}>
                {t('deps.files', { count: report.files.length })}
              </p>
            </>
          )}
        </section>
      )}

      <dl className="kv">
        <dt>{t('details.path')}</dt>
        <dd className="mono small">{asset.path}</dd>
        <dt>{t('details.size')}</dt>
        <dd>{formatBytes(asset.size)}</dd>
        <dt>{t('details.storage')}</dt>
        <dd>{asset.lfs ? t('details.lfs') : t('details.git')}</dd>
        <dt>{t('details.sha')}</dt>
        <dd className="mono small">{asset.sha.slice(0, 12)}</dd>
      </dl>

      <div>
        <button type="button" className="btn" onClick={copyPath}>
          {copied ? t('details.copied') : t('details.copyPath')}
        </button>
      </div>
    </aside>
  )
}
