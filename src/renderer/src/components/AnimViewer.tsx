import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAnimClip, type AnimClipInfo, type DependencyReport } from '@core/index'
import { unwrap } from '../remoteSource'
import { FbxViewer, type ViewPreset } from '../viewer/FbxViewer'
import { loadRig, rigCoverage, toThreeClip, type Rig } from '../viewer/animPlayer'
import type { LiveContext } from './ModelViewer'

interface Props {
  live: LiveContext
  /** Repo path of the .anim. */
  path: string
  report?: DependencyReport
  onInfo(info: AnimClipInfo): void
  onLoading?(loading: boolean): void
}

/** Rigs tried automatically before giving up (each is a download). */
const AUTO_TRIES = 4
/** A rig with this share of the clip's objects is taken without trying more: the first candidates are the likeliest models, a generic rig further down may match more bones yet be the wrong character. */
const GOOD_ENOUGH = 0.5

type Status = 'loading' | 'ready' | 'norig' | 'unsupported' | 'error'

/** Plays a clip on a model whose rig matches it: picked automatically from nearby models, or chosen by hand. */
export function AnimViewer({ live, path, report, onInfo, onLoading }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<FbxViewer>()
  /** The rig on screen, to replay the clip on it. */
  const current = useRef<Rig>()
  /** The automatic choice runs once per clip; picking by hand does not start it again. */
  const autoPicked = useRef(false)
  const [info, setInfo] = useState<AnimClipInfo>()
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [rig, setRig] = useState<string>()
  /** Rigs tried so far and how much of the clip each has. */
  const [coverage, setCoverage] = useState<Record<string, number>>({})
  const [playing, setPlaying] = useState(true)
  const [loop, setLoop] = useState(true)
  const callbacks = useRef({ onInfo, onLoading })
  callbacks.current = { onInfo, onLoading }

  useEffect(() => {
    callbacks.current.onLoading?.(status === 'loading')
  }, [status])
  useEffect(() => () => callbacks.current.onLoading?.(false), [])

  // The clip itself.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const v = new FbxViewer(el)
    viewer.current = v
    let cancelled = false
    setInfo(undefined)
    setRig(undefined)
    current.current = undefined
    autoPicked.current = false
    setCoverage({})
    setStatus('loading')
    setPlaying(true)
    void window.api.assets
      .readFile(live.repo, live.branch, path)
      .then(unwrap)
      .then((bytes) => {
        if (cancelled) return
        const clip = parseAnimClip(new TextDecoder().decode(bytes))
        setInfo(clip)
        callbacks.current.onInfo(clip)
        if (clip.compressed || (clip.kind !== 'generic' && clip.kind !== 'legacy')) setStatus('unsupported')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
      v.dispose()
      viewer.current = undefined
    }
  }, [live.repo, live.branch, path])

  const show = (r: Rig, clip: AnimClipInfo) => {
    const v = viewer.current
    if (!v) return
    current.current = r
    v.showGroup(r.root)
    v.playClip(toThreeClip(clip, r), loop)
    v.setPaused(false)
    setPlaying(true)
    setRig(r.path)
    setStatus('ready')
  }

  // Picks a rig: the nearby models in turn until one has most of the clip's objects.
  useEffect(() => {
    if (!info || status !== 'loading' || !report?.rigs || autoPicked.current) return
    autoPicked.current = true
    let cancelled = false
    let finished = false
    void (async () => {
      let best: { rig: Rig; score: number } | undefined
      for (const p of report.rigs!.slice(0, AUTO_TRIES)) {
        try {
          const r = await loadRig(live, p)
          if (cancelled) return
          const score = rigCoverage(info, r.root)
          setCoverage((c) => ({ ...c, [p]: score }))
          if (!best || score > best.score) best = { rig: r, score }
          if (score >= GOOD_ENOUGH) break
        } catch {
          setCoverage((c) => ({ ...c, [p]: 0 }))
        }
      }
      if (cancelled) return
      finished = true
      if (best && best.score > 0) show(best.rig, info)
      else setStatus('norig')
    })()
    return () => {
      cancelled = true
      // Interrupted (the clip changed): the next run starts the search again.
      if (!finished) autoPicked.current = false
    }
    // Reports arrive in steps with the same rigs: compared by content.
  }, [info, report?.rigs?.join('|'), status])

  const pickRig = async (p: string) => {
    if (!info) return
    setStatus('loading')
    try {
      const r = await loadRig(live, p)
      setCoverage((c) => ({ ...c, [p]: rigCoverage(info, r.root) }))
      show(r, info)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const view = (preset: ViewPreset) => viewer.current?.setView(preset)
  const overlay =
    status === 'loading'
      ? t('anim.findingRig')
      : status === 'unsupported' && info
        ? t(info.compressed ? 'anim.compressed' : `anim.unsupported.${info.kind}`)
        : status === 'norig'
          ? t('anim.noRig')
          : status === 'error'
            ? t('viewer.error', { message: error })
            : undefined
  const rigs = report?.rigs ?? []

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
      {overlay && (
        <div className="viewer-overlay" role="status">
          {overlay}
        </div>
      )}
      {(status === 'ready' || status === 'norig') && (
        <div className="viewer-tools" role="toolbar" aria-label={t('viewer.tools')}>
          {status === 'ready' && (
            <>
              <button
                type="button"
                className="viewer-btn"
                aria-pressed={playing}
                onClick={() => {
                  viewer.current?.setPaused(playing)
                  setPlaying(!playing)
                }}
              >
                {playing ? t('audio.pause') : t('audio.play')}
              </button>
              <button
                type="button"
                className="viewer-btn"
                aria-pressed={loop}
                onClick={() => {
                  const next = !loop
                  setLoop(next)
                  // Restarts the clip with the new loop setting.
                  if (info && current.current) viewer.current?.playClip(toThreeClip(info, current.current), next)
                }}
              >
                {t('audio.loop')}
              </button>
              {(['front', 'side', 'reset'] as const).map((p) => (
                <button key={p} type="button" className="viewer-btn" onClick={() => view(p)}>
                  {t(`viewer.view.${p}`)}
                </button>
              ))}
            </>
          )}
          {rigs.length > 0 && (
            <select className="select viewer-select" aria-label={t('anim.rig')} value={rig ?? ''} onChange={(e) => void pickRig(e.target.value)}>
              {!rig && <option value="">{t('anim.pickRig')}</option>}
              {rigs.map((p) => (
                <option key={p} value={p}>
                  {p.split('/').pop()}
                  {coverage[p] !== undefined ? ` · ${Math.round(coverage[p] * 100)}%` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {status === 'ready' && rig && <span className="viewer-hint">{t('anim.on', { name: rig.split('/').pop(), percent: Math.round((coverage[rig] ?? 0) * 100) })}</span>}
    </div>
  )
}
