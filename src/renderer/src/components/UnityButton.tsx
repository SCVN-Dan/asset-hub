import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunningUnity } from '@shared/ipc'

const LAST_KEY = 'assethub.lastUnityProject'
const lastProject = () => {
  try {
    return localStorage.getItem(LAST_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * "Import into Unity": the open Unity editors are listed (several projects can be
 * open); the button goes to the one used last, the arrow picks another. Without
 * an open editor it waits for one, refreshed when the app comes back to the front.
 */
export function UnityButton({ disabled, onImport }: { disabled?: boolean; onImport(editor: RunningUnity): void }) {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<RunningUnity[]>([])
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const refresh = () => void window.api.exporter.unityEditors().then(setEditors)
    refresh()
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 15_000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  if (!editors.length)
    return (
      <button type="button" className="btn" disabled title={t('unity.noneOpen')}>
        {t('unity.import')}
      </button>
    )

  const preferred = editors.find((e) => e.projectPath === lastProject()) ?? editors[0]
  const choose = (editor: RunningUnity) => {
    try {
      localStorage.setItem(LAST_KEY, editor.projectPath)
    } catch {
      // not remembered
    }
    setMenu(false)
    onImport(editor)
  }

  return (
    <div className="unity-button" ref={box}>
      <button type="button" className="btn" disabled={disabled} title={preferred.projectPath} onClick={() => choose(preferred)}>
        {t('unity.importInto', { project: preferred.project })}
      </button>
      {editors.length > 1 && (
        <button type="button" className="btn unity-more" disabled={disabled} aria-haspopup="menu" aria-expanded={menu} aria-label={t('unity.pick')} onClick={() => setMenu(!menu)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
      {menu && (
        <div className="unity-menu" role="menu">
          {editors.map((e) => (
            <button key={e.pid} type="button" role="menuitem" className="unity-menu-item" aria-current={e.pid === preferred.pid || undefined} title={e.projectPath} onClick={() => choose(e)}>
              <span>{e.project}</span>
              {e.version && <span className="muted small">{e.version}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
