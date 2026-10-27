import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { imageSize, type ModelStats } from '@core/checks/playable'
import { baseName, extractFbxTextureNames, type DependencyReport } from '@core/index'
import { unwrap } from '../remoteSource'
import { FbxViewer, type MaterialSlot, type TextureFile, type ViewPreset } from '../viewer/FbxViewer'

export interface LiveContext {
  repo: string
  branch: string
  /** Unity project root prefix inside the repo. */
  root: string
}

interface Props {
  live: LiveContext
  /** Repo path of the FBX. */
  path: string
  report?: DependencyReport
  onStats(stats: ModelStats): void
  onThumb(dataUrl: string): void
}

/** Formats three.js can display; others (PSD, EXR…) are listed but not drawn. */
const DRAWABLE = /\.(png|jpe?g|tga|bmp|gif|webp)$/i
const MAX_TEXTURES = 16
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

type Status = 'loading' | 'ready' | 'error'

export function ModelViewer({ live, path, report, onStats, onThumb }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<FbxViewer>()
  const files = useRef(new Map<string, TextureFile>())
  const fileBytes = useRef(0)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [autoRotate, setAutoRotate] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [clips, setClips] = useState<string[]>([])
  const [clip, setClip] = useState('')
  const callbacks = useRef({ onStats, onThumb })
  callbacks.current = { onStats, onThumb }

  /** Downloads texture files once per viewer and serves them as blob URLs. */
  const fetchTextures = async (paths: readonly string[]) => {
    const wanted = [...new Set(paths)].filter((p) => DRAWABLE.test(p) && !files.current.has(p)).slice(0, MAX_TEXTURES)
    await Promise.all(
      wanted.map(async (p) => {
        try {
          const bytes = unwrap(await window.api.assets.readFile(live.repo, live.branch, p))
          const ext = p.split('.').pop()!.toLowerCase()
          const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'application/octet-stream' }))
          files.current.set(p, { name: baseName(p), url, bytes: bytes.byteLength, ...imageSize(p, bytes) })
        } catch {
          // A texture that fails to download just renders untextured.
        }
      })
    )
  }

  const publish = () => {
    const v = viewer.current
    if (!v) return
    callbacks.current.onStats(v.stats(fileBytes.current, [...files.current.values()]))
    setTimeout(() => !v.isDisposed() && callbacks.current.onThumb(v.snapshot()), 700)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    const v = new FbxViewer(el)
    viewer.current = v
    const ownFiles = files.current
    setStatus('loading')
    setError('')
    setClips([])
    setClip('')
    setAutoRotate(false)
    setWireframe(false)
    void (async () => {
      try {
        const bytes = unwrap(await window.api.assets.readFile(live.repo, live.branch, path))
        if (cancelled) return
        fileBytes.current = bytes.byteLength
        const names = extractFbxTextureNames(bytes)
        const found = names.length ? unwrap(await window.api.assets.findByNames(live.repo, live.branch, names, path, live.root)) : {}
        await fetchTextures(Object.values(found).filter((p): p is string => !!p))
        if (cancelled) return
        const byName = new Map([...ownFiles.values()].map((f) => [f.name.toLowerCase(), f]))
        v.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, byName)
        setClips(v.stats(0, []).animations)
        setStatus('ready')
        publish()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      v.dispose()
      viewer.current = undefined
      for (const f of ownFiles.values()) URL.revokeObjectURL(f.url)
      ownFiles.clear()
    }
    // live is compared by value through its fields.
  }, [live.repo, live.branch, live.root, path])

  // Kind A: once dependencies are known, put the .mat textures on the model.
  useEffect(() => {
    if (status !== 'ready' || !report || report.kind !== 'A') return
    let cancelled = false
    void (async () => {
      const textures = report.materials.flatMap((m) => m.textures.filter((tex) => tex.path).map((tex) => ({ material: m.name, prop: tex.prop ?? '', path: tex.path! })))
      await fetchTextures(textures.map((tex) => tex.path))
      if (cancelled || !viewer.current) return
      const slots: MaterialSlot[] = textures.flatMap((tex) => {
        const file = files.current.get(tex.path)
        return file ? [{ material: tex.material, prop: tex.prop, file }] : []
      })
      await viewer.current.applyMaterialSlots(slots)
      if (!cancelled) publish()
    })()
    return () => {
      cancelled = true
    }
  }, [status, report])

  const view = (preset: ViewPreset) => viewer.current?.setView(preset)

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
      {status !== 'ready' && (
        <div className="viewer-overlay" role="status">
          {status === 'loading' ? t('viewer.loading') : t('viewer.error', { message: error })}
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
          {clips.length > 0 && (
            <label className="viewer-clips">
              <span className="sr-only">{t('viewer.animation')}</span>
              <select
                className="select"
                value={clip}
                onChange={(e) => {
                  setClip(e.target.value)
                  viewer.current?.playAnimation(e.target.value === '' ? null : Number(e.target.value))
                }}
              >
                <option value="">{t('viewer.noAnimation', { count: clips.length })}</option>
                {clips.map((c, i) => (
                  <option key={i} value={i}>
                    ▶ {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="viewer-hint">{t('viewer.hint')}</span>
        </>
      )}
    </div>
  )
}
