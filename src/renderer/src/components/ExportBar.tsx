import { useTranslation } from 'react-i18next'
import { formatBytes, type Asset, type DependencyReport } from '@core/index'
import type { ExportProgress, ExportResult } from '@shared/ipc'
import { ErrorNote } from './ErrorNote'

export interface PackItem {
  asset: Asset
  /** Repo path of the model. */
  path: string
  report?: DependencyReport
}

export interface ExportOptions {
  layout: 'source' | 'grouped'
  skipByName: boolean
}

export type ExportState =
  | { status: 'idle' }
  | { status: 'running'; progress?: ExportProgress }
  | { status: 'done'; result: ExportResult }
  | { status: 'error'; error: unknown }

interface Props {
  items: PackItem[]
  options: ExportOptions
  state: ExportState
  onOptions(options: ExportOptions): void
  onExport(): void
  onRemove(path: string): void
  onClear(): void
  onDismiss(): void
}

/** Files, size and warnings of a pack, from the dependency reports known so far. */
function summarize(items: readonly PackItem[], skipByName: boolean) {
  const files = new Set<string>()
  let bytes = 0
  let missing = 0
  let byName = 0
  const counted = new Set<string>()
  for (const { asset, path, report } of items) {
    if (!counted.has(path)) {
      counted.add(path)
      bytes += asset.size ?? 0
    }
    files.add(path)
    if (!report) continue
    const skip = new Set(skipByName ? report.embeddedTextures.filter((t) => t.path && t.matchedBy === 'name').map((t) => t.path!) : [])
    for (const f of report.files) if (!f.endsWith('.meta') && !skip.has(f)) files.add(f)
    for (const tex of [...report.materials.flatMap((m) => m.textures), ...report.embeddedTextures]) {
      if (tex.missing) missing++
      else if (tex.path && !skip.has(tex.path) && !counted.has(tex.path)) {
        counted.add(tex.path)
        bytes += tex.size ?? 0
        if (tex.matchedBy === 'name') byName++
      }
    }
    missing += report.materials.filter((m) => m.missing).length
  }
  return { files: files.size, bytes, missing, byName, pending: items.some((i) => !i.report) }
}

export function ExportBar({ items, options, state, onOptions, onExport, onRemove, onClear, onDismiss }: Props) {
  const { t } = useTranslation()
  const sum = summarize(items, options.skipByName)
  const running = state.status === 'running'
  const progress = state.status === 'running' ? state.progress : undefined

  return (
    <section className="export-bar" aria-label={t('export.title')}>
      {items.length > 0 && (
        <>
          <div className="export-head">
            <strong>{t('export.pack', { count: items.length })}</strong>
            <span className="muted small">
              {t('export.summary', { files: sum.files, size: formatBytes(sum.bytes) })}
              {sum.pending && ` · ${t('export.resolving')}`}
            </span>
            {sum.missing > 0 && <span className="badge badge-warn">{t('export.missing', { count: sum.missing })}</span>}
            {sum.byName > 0 && <span className="badge">{t('export.byName', { count: sum.byName })}</span>}
          </div>
          <ul className="export-items">
            {items.map((i) => (
              <li key={i.path}>
                <span className="dep-name">{i.asset.name}</span>
                <button type="button" className="link-btn" aria-label={t('export.remove', { name: i.asset.name })} onClick={() => onRemove(i.path)} disabled={running}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="export-actions">
            <label className="picker">
              <span className="muted small">{t('export.layout')}</span>
              <select
                className="select"
                value={options.layout}
                disabled={running}
                onChange={(e) => onOptions({ ...options, layout: e.target.value as ExportOptions['layout'] })}
              >
                <option value="source">{t('export.layoutSource')}</option>
                <option value="grouped">{t('export.layoutGrouped')}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={options.skipByName} disabled={running} onChange={(e) => onOptions({ ...options, skipByName: e.target.checked })} />
              {t('export.skipByName')}
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClear} disabled={running}>
              {t('export.clear')}
            </button>
            <button type="button" className="btn btn-primary" onClick={onExport} disabled={running}>
              {running ? t('export.exporting') : t('export.export', { count: items.length })}
            </button>
          </div>
        </>
      )}

      {running && (
        <div className="export-status" role="status">
          <span className="small">{progress ? t(`export.stage.${progress.stage}`, { done: progress.done, total: progress.total }) : t('export.choosing')}</span>
          <progress className="progress" max={progress?.total || undefined} value={progress ? progress.done : undefined} />
        </div>
      )}
      {state.status === 'done' && state.result.path && (
        <div className="export-status done" role="status">
          <span className="small">
            {t('export.done', { count: state.result.assets ?? 0, size: formatBytes(state.result.bytes) })}{' '}
            <span className="mono">{state.result.path.split(/[\\/]/).pop()}</span>
          </span>
          {state.result.skipped && state.result.skipped.length > 0 && (
            <span className="small muted">{t('export.skipped', { count: state.result.skipped.length, list: state.result.skipped.map((s) => s.path.split('/').pop()).join(', ') })}</span>
          )}
          <div className="export-actions">
            <button type="button" className="btn" onClick={() => void window.api.exporter.showInFolder(state.result.path!)}>
              {t('export.showInFolder')}
            </button>
            <button type="button" className="btn" onClick={onDismiss}>
              {t('export.dismiss')}
            </button>
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div className="export-status">
          <ErrorNote error={state.error} />
          <div>
            <button type="button" className="btn" onClick={onDismiss}>
              {t('export.dismiss')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
