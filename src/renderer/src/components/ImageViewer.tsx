import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { importedTextureSize, parseTextureMeta, type TextureImport } from '@core/index'
import type { StatsSummary } from '@core/checks/playable'
import { unwrap } from '../remoteSource'
import { decodeImage } from '../viewer/textures'
import type { LiveContext } from './ModelViewer'

/** What the texture panel shows about an image. */
export interface ImageInfo {
  width: number
  height: number
  bytes: number
  format: string
  hasAlpha: boolean
  /** Import settings from the .meta, when there is one. */
  import?: TextureImport
}

interface Props {
  live: LiveContext
  /** Repo path of the image. */
  path: string
  onInfo(info: ImageInfo): void
  onStats?(stats: StatsSummary): void
  onLoading?(loading: boolean): void
}

type Backdrop = 'checker' | 'dark' | 'light'

/** A texture at full quality: fitted or at 1:1, over a checkerboard to show transparency. */
export function ImageViewer({ live, path, onInfo, onStats, onLoading }: Props) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [actual, setActual] = useState(false)
  const [backdrop, setBackdrop] = useState<Backdrop>('checker')
  const callbacks = useRef({ onInfo, onStats, onLoading })
  callbacks.current = { onInfo, onStats, onLoading }

  useEffect(() => {
    callbacks.current.onLoading?.(status === 'loading')
  }, [status])
  useEffect(() => () => callbacks.current.onLoading?.(false), [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError('')
    setActual(false)
    void (async () => {
      try {
        const [bytes, metaText] = await Promise.all([
          window.api.assets.readFile(live.repo, live.branch, path).then(unwrap),
          window.api.assets.readFile(live.repo, live.branch, `${path}.meta`).then((r) => (r.ok ? new TextDecoder().decode(r.data) : undefined))
        ])
        if (cancelled) return
        const img = await decodeImage(path, bytes)
        if (cancelled) return img.bitmap.close()
        const el = canvas.current!
        el.width = img.width
        el.height = img.height
        el.getContext('2d')!.drawImage(img.bitmap, 0, 0)
        img.bitmap.close()
        const imp = metaText ? parseTextureMeta(metaText) : undefined
        callbacks.current.onInfo({ width: img.width, height: img.height, bytes: bytes.byteLength, format: img.format, hasAlpha: img.hasAlpha, import: imp })
        callbacks.current.onStats?.({
          triangles: 0,
          vertices: 0,
          bones: 0,
          clips: 0,
          materials: 0,
          fileBytes: 0,
          textureBytes: bytes.byteLength,
          maxTextureSize: imp ? importedTextureSize(img.width, img.height, imp) : Math.max(img.width, img.height),
          width: img.width,
          height: img.height,
          source: 'viewer'
        })
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [live.repo, live.branch, path])

  return (
    <div className={`viewer image-viewer backdrop-${backdrop}`} data-actual={actual}>
      <div className="image-scroll">
        <canvas ref={canvas} className="image-canvas" />
      </div>
      {status !== 'ready' && (
        <div className="viewer-overlay" role="status">
          {status === 'loading' ? t('viewer.loading') : t('texture.cannotShow', { message: error })}
        </div>
      )}
      {status === 'ready' && (
        <div className="viewer-tools" role="toolbar" aria-label={t('viewer.tools')}>
          <button type="button" className="viewer-btn" aria-pressed={actual} onClick={() => setActual((a) => !a)}>
            {actual ? t('texture.fit') : t('texture.actual')}
          </button>
          {(['checker', 'dark', 'light'] as const).map((b) => (
            <button key={b} type="button" className="viewer-btn" aria-pressed={backdrop === b} onClick={() => setBackdrop(b)}>
              {t(`texture.backdrop.${b}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
