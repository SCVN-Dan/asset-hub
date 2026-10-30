import { useTranslation } from 'react-i18next'
import type { WatchedBranch } from '@shared/settings'

/** Sidebar: the branches followed (👁 next to the branch picker), each with how many assets came in since last seen. */
export function WatchNav({
  watched,
  news,
  current,
  onOpen,
  onRemove
}: {
  watched: WatchedBranch[]
  news: Record<string, { added: string[]; more: boolean }>
  current: { repo: string; branch: string }
  onOpen(repo: string, branch: string): void
  onRemove(w: WatchedBranch): void
}) {
  const { t } = useTranslation()
  if (!watched.length) return null
  return (
    <nav aria-label={t('watch.title')} className="collections-nav">
      <span className="label-caps">{t('watch.title')}</span>
      <div className="tabs" role="group" aria-label={t('watch.title')}>
        {watched.map((w) => {
          const n = news[`${w.repo}\n${w.branch}`]
          const count = n?.added.length ?? 0
          return (
            <div key={`${w.repo}\n${w.branch}`} className="watch-row">
              <button type="button" className="tab" aria-pressed={current.repo === w.repo && current.branch === w.branch} title={`${w.repo} · ${w.branch}`} onClick={() => onOpen(w.repo, w.branch)}>
                <span aria-hidden="true">👁</span>
                <span className="collection-label">
                  {w.repo.split('/').pop()} <span className="muted">· {w.branch}</span>
                </span>
                {count > 0 && <span className="watch-count">{count}{n?.more ? '+' : ''}</span>}
              </button>
              <button type="button" className="watch-remove" aria-label={t('watch.stop')} title={t('watch.stop')} onClick={() => onRemove(w)}>
                ×
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
