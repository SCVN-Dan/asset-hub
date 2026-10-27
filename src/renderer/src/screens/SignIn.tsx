import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '@shared/settings'
import { ErrorNote } from '../components/ErrorNote'
import { CubeIcon, GithubIcon } from '../components/Icons'
import { LangToggle } from '../components/LangToggle'

interface Props {
  language: Language
  onLanguage(language: Language): void
  onToken(token: string): Promise<void>
  onGh(): Promise<void>
  onDemo(): void
}

type Busy = 'pat' | 'gh' | undefined

export function SignIn({ language, onLanguage, onToken, onGh, onDemo }: Props) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<Busy>()
  const [error, setError] = useState<unknown>()
  const [ghPrompt, setGhPrompt] = useState<{ code: string; url: string }>()
  const cancelled = useRef(false)

  useEffect(() => window.api.auth.onGhLoginPrompt(setGhPrompt), [])

  const run = async (kind: Exclude<Busy, undefined>, action: () => Promise<void>) => {
    setBusy(kind)
    setError(undefined)
    cancelled.current = false
    try {
      await action()
    } catch (err) {
      if (!cancelled.current) setError(err)
    } finally {
      setBusy(undefined)
      setGhPrompt(undefined)
    }
  }

  const cancelGh = () => {
    cancelled.current = true
    void window.api.auth.cancelGhWebLogin()
  }

  return (
    <div className="signin">
      <div className="signin-lang">
        <LangToggle value={language} onChange={onLanguage} />
      </div>
      <div className="signin-col">
        <div className="brand">
          <span style={{ color: 'var(--accent-text)' }}>
            <CubeIcon size={36} />
          </span>
          <div>
            <div className="brand-name">Asset Hub</div>
            <div className="muted small">{t('signin.tagline')}</div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1>{t('signin.title')}</h1>
            <p className="muted">{t('signin.desc')}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy !== undefined}
              aria-busy={busy === 'gh'}
              onClick={() => void run('gh', onGh)}
            >
              <GithubIcon />
              {busy === 'gh' ? t('signin.checking') : t('signin.github')}
            </button>
            <span className="muted small">{t('signin.ghCliSub')}</span>
          </div>

          {ghPrompt && busy === 'gh' && (
            <div className="device-code" role="status">
              <span className="muted small">{t('signin.ghCodeHint')}</span>
              <span className="device-code-value mono">{ghPrompt.code}</span>
              <span className="small" style={{ color: 'var(--accent-text)' }}>
                {t('signin.ghCopied')}
              </span>
              <div className="field-row">
                <button type="button" className="btn btn-primary" onClick={() => void window.api.openExternal(ghPrompt.url)}>
                  {t('signin.ghOpen')}
                </button>
                <button type="button" className="btn" onClick={cancelGh}>
                  {t('signin.cancel')}
                </button>
              </div>
              <ol className="steps">
                <li>{t('signin.step1')}</li>
                <li>{t('signin.step2')}</li>
                <li>{t('signin.step3')}</li>
                <li>{t('signin.step4')}</li>
              </ol>
              <span className="muted small">{t('signin.ghWaiting')}</span>
            </div>
          )}

          <div className="divider">{t('signin.or')}</div>

          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              void run('pat', () => onToken(token))
            }}
          >
            <label htmlFor="pat">{t('signin.patLabel')}</label>
            <div className="field-row">
              <input
                id="pat"
                className="input mono"
                type="password"
                placeholder="github_pat_…"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy !== undefined || !token.trim()}>
                {busy === 'pat' ? t('signin.checking') : t('signin.use')}
              </button>
            </div>
            <span className="muted small">{t('signin.patScope')}</span>
          </form>

          {error !== undefined && <ErrorNote error={error} />}
        </div>

        <p className="muted small center" style={{ margin: 0 }}>
          {t('signin.sso')}
        </p>
        <button type="button" className="btn" style={{ alignSelf: 'center' }} onClick={onDemo}>
          {t('signin.demo')}
        </button>
      </div>
    </div>
  )
}
