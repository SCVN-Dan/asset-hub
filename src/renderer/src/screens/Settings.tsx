import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthStatus } from '@shared/ipc'
import type { Settings as AppSettings, Language } from '@shared/settings'
import { ChevronLeftIcon } from '../components/Icons'
import { LangToggle } from '../components/LangToggle'

interface Props {
  settings: AppSettings
  auth: AuthStatus | undefined
  onChange(patch: Partial<AppSettings>): void
  onSignOut(): void
  onBack(): void
}

const parseFolders = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function Settings({ settings, auth, onChange, onSignOut, onBack }: Props) {
  const { t } = useTranslation()
  const [folders, setFolders] = useState(settings.excludedFolders.join(', '))
  useEffect(() => setFolders(settings.excludedFolders.join(', ')), [settings.excludedFolders])

  const chooseCache = async () => {
    const folder = await window.api.chooseFolder()
    if (folder) onChange({ cacheDir: folder })
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <button type="button" className="btn icon-btn" aria-label={t('common.back')} onClick={onBack}>
          <ChevronLeftIcon />
        </button>
        <h1>{t('settings.title')}</h1>
      </div>

      <section className="setting">
        <h2>{t('settings.account')}</h2>
        {auth?.signedIn ? (
          <>
            <span>
              {t('settings.signedInAs', { login: auth.login })} · <span className="muted">{t(`settings.method.${auth.method}`)}</span>
            </span>
            {auth.persisted === false && <span className="muted small">{t('settings.notPersisted')}</span>}
          </>
        ) : (
          <span className="muted">{t('settings.demoMode')}</span>
        )}
        <div>
          <button type="button" className="btn" onClick={onSignOut}>
            {auth?.signedIn ? t('settings.signOut') : t('settings.signIn')}
          </button>
        </div>
      </section>

      <section className="setting">
        <h2>{t('common.language')}</h2>
        <span className="muted small">{t('settings.languageHelp')}</span>
        <div>
          <LangToggle value={settings.language} onChange={(language: Language) => onChange({ language })} />
        </div>
      </section>

      <section className="setting">
        <h2>
          <label htmlFor="excluded">{t('settings.excluded')}</label>
        </h2>
        <span className="muted small">{t('settings.excludedHelp')}</span>
        <input
          id="excluded"
          className="input mono"
          value={folders}
          placeholder="_ThirdParty, Plugins"
          onChange={(e) => setFolders(e.target.value)}
          onBlur={() => onChange({ excludedFolders: parseFolders(folders) })}
          onKeyDown={(e) => e.key === 'Enter' && onChange({ excludedFolders: parseFolders(folders) })}
        />
      </section>

      <section className="setting">
        <h2>
          <label htmlFor="cache">{t('settings.cacheDir')}</label>
        </h2>
        <span className="muted small">{t('settings.cacheDirHelp')}</span>
        <div className="field-row">
          <input id="cache" className="input mono" value={settings.cacheDir} readOnly />
          <button type="button" className="btn" onClick={chooseCache}>
            {t('settings.choose')}
          </button>
        </div>
      </section>
    </div>
  )
}
