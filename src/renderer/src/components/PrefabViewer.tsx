import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelStats } from '@core/checks/playable'
import type { DependencyReport } from '@core/index'
import { FbxViewer, type ViewPreset } from '../viewer/FbxViewer'
import { buildPrefab, dressPrefab, type PrefabBuild } from '../viewer/prefabBuild'
import { buildEffect } from '../viewer/effectBuild'
import type { EffectPlayer } from '../viewer/particlePlayer'
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
  const built = useRef<{ key: string; build: PrefabBuild; effect?: EffectPlayer; stop?: () => void }>()
  const [status, setStatus] = useState<Status>('waiting')
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(0)
  const [autoRotate, setAutoRotate] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  /** Particle controls, shown when the prefab has particle systems. */
  const [fx, setFx] = useState<{ paused: boolean; loop: boolean; speed: number }>()
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
    setFx(undefined)
    setAutoRotate(false)
    setWireframe(false)
    return () => {
      built.current?.stop?.()
      built.current?.effect?.dispose()
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
        const effect = build.anchors.length ? await buildEffect(live, report, build.anchors) : undefined
        if (cancelled || !owner || owner.isDisposed() || owner !== viewer.current) {
          effect?.dispose()
          return build.dispose()
        }
        const previous = built.current
        previous?.stop?.()
        previous?.effect?.dispose()
        built.current = { key, build, effect, stop: effect && owner.addUpdater((dt) => effect.update(dt)) }
        // The camera takes in where particles fly, not only the meshes.
        owner.showGroup(build.group, effect?.extent())
        await dressPrefab(owner, build)
        previous?.build.dispose()
        if (cancelled) return
        setMissing(build.missing)
        if (effect) {
          owner.setWireframe(wireframe)
          // A rebuild (more files found) keeps the controls as the user left them.
          setFx((f) => {
            const next = f ?? { paused: false, loop: true, speed: 1 }
            Object.assign(effect, next)
            return next
          })
          setStatus('ready')
          callbacks.current.onStats(owner.stats(build.modelBytes, build.textures))
          // Taken once the effect has had time to fill in.
          setTimeout(() => !owner.isDisposed() && callbacks.current.onThumb(owner.snapshot()), 900)
          return
        }
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
  const setEffect = (patch: Partial<NonNullable<typeof fx>>) => {
    const next = { paused: false, loop: true, speed: 1, ...fx, ...patch }
    const effect = built.current?.effect
    if (effect) Object.assign(effect, next)
    setFx(next)
  }
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
          {fx && (
            <div className="viewer-tools viewer-tools-bottom" role="toolbar" aria-label={t('particles.title')}>
              <button type="button" className="viewer-btn" aria-pressed={!fx.paused} onClick={() => setEffect({ paused: !fx.paused })}>
                {fx.paused ? t('particles.play') : t('particles.pause')}
              </button>
              <button type="button" className="viewer-btn" onClick={() => built.current?.effect?.restart()}>
                {t('particles.restart')}
              </button>
              <button type="button" className="viewer-btn" aria-pressed={fx.loop} title={t('particles.loopHint')} onClick={() => setEffect({ loop: !fx.loop })}>
                {t('particles.loop')}
              </button>
              {[0.25, 0.5, 1].map((s) => (
                <button key={s} type="button" className="viewer-btn" aria-pressed={fx.speed === s} onClick={() => setEffect({ speed: s })}>
                  {s}×
                </button>
              ))}
            </div>
          )}
          <span className="viewer-hint">{missing > 0 ? t('prefabView.missing', { count: missing }) : t('viewer.hint')}</span>
        </>
      )}
    </div>
  )
}
