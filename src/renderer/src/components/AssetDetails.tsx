import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes, type Asset, type AssetTypeHandler, type PreviewResult } from '@core/index'
import { CubeIcon } from './Icons'

interface Props {
  asset: Asset | undefined
  handler: AssetTypeHandler | undefined
  cacheDir: string
}

export function AssetDetails({ asset, handler, cacheDir }: Props) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<PreviewResult | undefined>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setPreview(undefined)
    setCopied(false)
    if (!asset || !handler) return
    let cancelled = false
    void handler.preview.load(asset, { cacheDir }).then((result) => {
      if (!cancelled) setPreview(result)
    })
    return () => {
      cancelled = true
    }
  }, [asset, handler, cacheDir])

  if (!asset) {
    return (
      <aside className="details" aria-label={t('details.label')}>
        <p className="empty">{t('details.empty')}</p>
      </aside>
    )
  }

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
      <div className="preview-box">
        <CubeIcon size={72} />
        <span>{preview?.status === 'unavailable' ? t(preview.reasonKey) : ''}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>{asset.name}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {handler && <span className="badge badge-accent">{t(handler.labelKey)}</span>}
          {asset.lfs && <span className="badge">LFS</span>}
        </div>
      </div>

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="label-caps">{t('details.deps')}</span>
        <p className="note" style={{ margin: 0 }}>
          {t('details.depsLater')}
        </p>
      </div>

      <div style={{ marginTop: 'auto' }}>
        <button type="button" className="btn" onClick={copyPath}>
          {copied ? t('details.copied') : t('details.copyPath')}
        </button>
      </div>
    </aside>
  )
}
