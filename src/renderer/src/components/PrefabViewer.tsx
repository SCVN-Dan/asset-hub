import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelStats } from '@core/checks/playable'
import type { DependencyReport } from '@core/index'
import { FbxViewer, type ViewPreset } from '../viewer/FbxViewer'
import { buildPrefab, dressPrefab, type PrefabBuild } from '../viewer/prefabBuild'
import type { LiveContext } from './ModelViewer'

interface Props {
  live: LiveContext
  /** Repo path of the prefab. */
  path: string
  report?: DependencyReport
  onStats(stats: ModelStats): void
  onThumb(dataUrl: string): void
  onLoading?(loading: boolean): void
}

type Status = 'waiting' | 'loading' | 'ready' | 'empty' | 'error'

/** What a build depends on: rebuilt only when the report finds more files, not on every step. */
const buildKey = (r: DependencyReport) => [...Object.keys(r.guidPaths ?? {}).sort(), ...r.materials.flatMap((m) => m.textures.map((t) => t.path ?? ''))].join('|')

/** A prefab put together from its models and materials, with the model viewer's controls. */
export function PrefabViewer({ live, path, report, onStats, onThumb, onLoading }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<FbxViewer>()
  const built = useRef<{ key: string; build: PrefabBuild }>()
  const [status, setStatus] = useState<Status>('waiting')
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(0)
  const [autoRotate, setAutoRotate] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const callbacks = useRef({ onStats, onThumb, onLoading })
  callbacks.current = { onStats, onThumb, onLoading }

  useEffect(() => {
    callbacks.current.onLoading?.(status === 'loading' || status === 'waiting')
  }, [status])
  useEffect(() => () => callbacks.current.onLoading?.(false), [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const v = new FbxViewer(el)
    viewer.current = v
    setStatus('waiting')
    setMissing(0)
    setAutoRotate(false)
    setWireframe(false)
    return () => {
      v.dispose()
      viewer.current = undefined
      built.current?.build.dispose()
      built.current = undefined
    }
  }, [live.repo, live.branch, live.root, path])

  useEffect(() => {
    if (!report) return
    const key = buildKey(report)
    if (built.current?.key === key) return
    const owner = viewer.current
    let cancelled = false
    if (!built.current) setStatus('loading')
    void (async () => {
      try {
        const build = await buildPrefab(live, path, report)
        if (cancelled || !owner || owner.isDisposed() || owner !== viewer.current) return build.dispose()
        const previous = built.current
        built.current = { key, build }
        owner.showGroup(build.group)
        await dressPrefab(owner, build)
        previous?.build.dispose()
        if (cancelled) return
        setMissing(build.missing)
        // Nothing found yet while models are still being looked up: keep waiting for the next step.
        if (!build.meshes) return setStatus(report.partial ? 'loading' : 'empty')
        owner.setWireframe(wireframe)
        setStatus('ready')
        callbacks.current.onStats(owner.stats(build.modelBytes, build.textures))
        setTimeout(() => !owner.isDisposed() && callbacks.current.onThumb(owner.snapshot()), 300)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [report])

  const view = (preset: ViewPreset) => viewer.current?.setView(preset)
  const overlay =
    status === 'waiting' || status === 'loading'
      ? t('prefabView.loading')
      : status === 'empty'
        ? t(report?.warnings.includes('uiPrefab') ? 'prefabView.ui' : report?.warnings.includes('particles') ? 'prefabView.particles' : 'prefabView.empty')
        : status === 'error'
          ? t('viewer.error', { message: error })
          : undefined

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
      {overlay && (
        <div className="viewer-overlay" role="status">
          {overlay}
        </div>
      )}
      {status === 'ready' && (
        <>
          <div className="viewer-tools" role="toolbar" aria-label={t('viewer.tools')}>
            {(['front', 'side', 'top', 'reset'] as const).map((p) => (
              <button key={p} type="button" className="viewer-btn" onClick={() => view(p)}>
                {t(`viewer.view.${p}`)}
              </button>
            ))}
            <button
              type="button"
              className="viewer-btn"
              aria-pressed={autoRotate}
              onClick={() => {
                viewer.current?.setAutoRotate(!autoRotate)
                setAutoRotate(!autoRotate)
              }}
            >
              {t('viewer.autoRotate')}
            </button>
            <button
              type="button"
              className="viewer-btn"
              aria-pressed={wireframe}
              onClick={() => {
                viewer.current?.setWireframe(!wireframe)
                setWireframe(!wireframe)
              }}
            >
              {t('viewer.wireframe')}
            </button>
          </div>
          <span className="viewer-hint">{missing > 0 ? t('prefabView.missing', { count: missing }) : t('viewer.hint')}</span>
        </>
      )}
    </div>
  )
}
