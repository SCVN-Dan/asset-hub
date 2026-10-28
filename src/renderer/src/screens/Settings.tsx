import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthStatus } from '@shared/ipc'
import type { Settings as AppSettings, Language } from '@shared/settings'
import { BUDGET_KEYS, BUDGET_PRESETS, budgetFor, type BudgetPreset, type PlayableBudget } from '@core/checks/playable'
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

/** How each limit is shown and typed: bytes as MB or KB. */
const UNITS: Record<keyof PlayableBudget, { unit: string; scale: number }> = {
  triangles: { unit: 'tris', scale: 1 },
  textureSize: { unit: 'px', scale: 1 },
  textureBytes: { unit: 'MB', scale: 1024 * 1024 },
  fileBytes: { unit: 'MB', scale: 1024 * 1024 },
  bones: { unit: '', scale: 1 },
  audioBytes: { unit: 'KB', scale: 1024 },
  audioSeconds: { unit: 's', scale: 1 }
}

/** Preset choice, and the limits it stands for (editable for the custom preset). */
function BudgetSetting({ settings, onChange }: Pick<Props, 'settings' | 'onChange'>) {
  const { t } = useTranslation()
  const preset = settings.budgetPreset ?? 'standard'
  const budget = budgetFor(preset, settings.customBudget)
  const setLimit = (key: keyof PlayableBudget, text: string) => {
    const value = Number(text) * UNITS[key].scale
    if (Number.isFinite(value) && value > 0 && value !== budget[key]) onChange({ customBudget: { ...settings.customBudget, [key]: value } })
  }
  return (
    <section className="setting">
      <h2>
        <label htmlFor="budget">{t('budget.preset')}</label>
      </h2>
      <span className="muted small">{t('budget.presetHint')}</span>
      <select id="budget" className="select" value={preset} onChange={(e) => onChange({ budgetPreset: e.target.value as BudgetPreset })}>
        {BUDGET_PRESETS.map((p) => (
          <option key={p} value={p}>
            {t(`budget.presets.${p}`)}
          </option>
        ))}
      </select>
      <dl className="stat-grid">
        {BUDGET_KEYS.map((key) => (
          <div key={`${preset}:${key}`}>
            <dt>{t(`budget.limits.${key}`)}</dt>
            <dd>
              {preset === 'custom' ? (
                <input
                  className="input budget-input"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={+(budget[key] / UNITS[key].scale).toFixed(2)}
                  onBlur={(e) => setLimit(key, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setLimit(key, e.currentTarget.value)}
                />
              ) : (
                +(budget[key] / UNITS[key].scale).toFixed(2)
              )}{' '}
              {UNITS[key].unit}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

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

      <BudgetSetting settings={settings} onChange={onChange} />

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
