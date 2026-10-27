import { formatBytes, type Asset, type AssetTypeHandler } from '@core/index'
import { CubeIcon } from './Icons'

interface Props {
  asset: Asset
  handler: AssetTypeHandler | undefined
  /** Data URL of a preview rendered earlier. */
  thumb?: string
  selected: boolean
  onSelect(): void
}

export function AssetCard({ asset, handler, thumb, selected, onSelect }: Props) {
  return (
    <button type="button" className="asset-card" aria-pressed={selected} onClick={onSelect} title={asset.path}>
      <span className="asset-thumb">
        {thumb ? <img className="asset-img" src={thumb} alt="" /> : <CubeIcon size={56} />}
        {handler && <span className="type-badge">{handler.badge}</span>}
      </span>
      <span className="asset-meta">
        <span className="asset-name">{asset.name}</span>
        <span className="asset-sub">
          <span>{formatBytes(asset.size)}</span>
          {asset.lfs && <span className="badge">LFS</span>}
        </span>
      </span>
    </button>
  )
}
