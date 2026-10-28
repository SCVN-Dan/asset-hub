import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes, type Asset, type AssetTypeHandler } from '@core/index'
import type { StatsSummary } from '@core/checks/playable'
import { StatsLine } from './CatalogPanel'
import { CubeIcon } from './Icons'

interface Props {
  asset: Asset
  handler: AssetTypeHandler | undefined
  /** Data URL of a preview rendered earlier. */
  thumb?: string
  /** A thumbnail is being rendered in the background. */
  generating?: boolean
  /** Identical files (same content) elsewhere in the project, shown as one card. */
  copies?: number
  selected: boolean
  onSelect(): void
  /** Called when the card enters or leaves the screen, to render thumbnails lazily. */
  onVisible?(visible: boolean): void
  /** Extra line under the size, e.g. where the file is in other branches. */
  note?: string
  /** Measurements, when known: triangle count and playable-budget verdict. */
  stats?: StatsSummary
}

export function AssetCard({ asset, handler, thumb, generating, copies, selected, onSelect, onVisible, note, stats }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)
  const visibleRef = useRef(onVisible)
  visibleRef.current = onVisible

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => visibleRef.current?.(entry.isIntersecting), { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
    // Re-observed when the callback appears, so a card already on screen reports itself.
  }, [!!onVisible])

  return (
    <button
      ref={ref}
      type="button"
      className="asset-card"
      data-asset-id={asset.id}
      aria-pressed={selected}
      onClick={onSelect}
      title={asset.path}
    >
      <span className="asset-thumb">
        {thumb ? <img className="asset-img" src={thumb} alt="" loading="lazy" /> : <CubeIcon size={56} />}
        {handler && <span className="type-badge">{handler.badge}</span>}
        {copies && copies > 1 ? <span className="copies-badge" title={t('browse.copiesTitle', { count: copies })}>×{copies}</span> : null}
        {generating && !thumb && <span className="thumb-spinner" aria-label={t('browse.generatingThumb')} />}
      </span>
      <span className="asset-meta">
        <span className="asset-name">{asset.name}</span>
        <span className="asset-sub">
          <span>{formatBytes(asset.size)}</span>
          {asset.lfs && <span className="badge">LFS</span>}
        </span>
        {stats && <StatsLine stats={stats} short />}
        {note && <span className="asset-note">{note}</span>}
      </span>
    </button>
  )
}

/** Placeholder card shown while a branch is loading. */
export function SkeletonCard() {
  return (
    <span className="asset-card skeleton" aria-hidden="true">
      <span className="asset-thumb" />
      <span className="asset-meta">
        <span className="skeleton-line" />
        <span className="skeleton-line short" />
      </span>
    </span>
  )
}
