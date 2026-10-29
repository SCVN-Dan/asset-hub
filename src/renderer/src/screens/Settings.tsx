import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthStatus, CacheUsage } from '@shared/ipc'
import { CACHE_LIMITS_GB, DEFAULT_CACHE_LIMIT_GB, DEFAULT_EXPORT_LAYOUT, EXPORT_LAYOUTS, type Settings as AppSettings, type Language } from '@shared/settings'
import { formatBytes } from '@core/index'
import { BUDGET_KEYS, BUDGET_PRESETS, DEFAULT_BUDGET_PRESET, budgetFor, type BudgetPreset, type PlayableBudget } from '@core/checks/playable'
import { Dropdown } from '../components/Dropdown'
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
  audioSeconds: { unit: 's', scale: 1 },
  fontBytes: { unit: 'KB', scale: 1024 },
  particles: { unit: '', scale: 1 }
}

/** The Unity project packages are compared with before export (read only). */
function TargetProjectSetting({ settings, onChange }: Pick<Props, 'settings' | 'onChange'>) {
  const { t } = useTranslation()
  const [error, setError] = useState(false)
  const choose = async () => {
    const folder = await window.api.chooseFolder()
    if (!folder) return
    const ok = await window.api.isUnityProject(folder)
    setError(!ok)
    if (ok) onChange({ targetProject: folder })
  }
  return (
    <section className="setting">
      <h2>
        <label htmlFor="target-project">{t('target.setting')}</label>
      </h2>
      <span className="muted small">{t('target.settingHelp')}</span>
      <div className="field-row">
        <input id="target-project" className="input mono" value={settings.targetProject ?? ''} placeholder={t('target.none')} readOnly />
        <button type="button" className="btn" onClick={() => void choose()}>
          {t('settings.choose')}
        </button>
        {settings.targetProject && (
          <button type="button" className="btn" onClick={() => onChange({ targetProject: '' })}>
            {t('target.clear')}
          </button>
        )}
      </div>
      {error && <p className="warn-note">{t('target.notProject')}</p>}
    </section>
  )
}

/** Preset choice, and the limits it stands for (editable for the custom preset). */
function BudgetSetting({ settings, onChange }: Pick<Props, 'settings' | 'onChange'>) {
  const { t } = useTranslation()
  const preset = settings.budgetPreset ?? DEFAULT_BUDGET_PRESET
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
      <div>
        <Dropdown
          id="budget"
          value={preset}
          options={BUDGET_PRESETS.map((p) => ({ value: p, label: t(`budget.presets.${p}`) }))}
          onChange={(budgetPreset: BudgetPreset) => onChange({ budgetPreset })}
          label={t('budget.preset')}
        />
      </div>
      {preset !== 'off' && (
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
      )}
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
          <label htmlFor="export-layout">{t('export.layout')}</label>
        </h2>
        <span className="muted small">{t('settings.exportLayoutHelp')}</span>
        <div>
          <Dropdown
            id="export-layout"
            value={settings.exportLayout ?? DEFAULT_EXPORT_LAYOUT}
            options={EXPORT_LAYOUTS.map((l) => ({ value: l, label: t(`export.layout${l[0].toUpperCase()}${l.slice(1)}`) }))}
            onChange={(exportLayout: (typeof EXPORT_LAYOUTS)[number]) => onChange({ exportLayout })}
            label={t('export.layout')}
          />
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

      <TargetProjectSetting settings={settings} onChange={onChange} />

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

      <CacheSetting settings={settings} onChange={onChange} />
    </div>
  )
}

/** How much the cache holds, its size limit, and a way to empty it. */
function CacheSetting({ settings, onChange }: Pick<Props, 'settings' | 'onChange'>) {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<CacheUsage>()
  const [clearing, setClearing] = useState(false)
  const measure = () => void window.api.cache.usage().then((r) => r.ok && setUsage(r.data))
  useEffect(measure, [settings.cacheDir, settings.cacheLimitGB])
  const limit = settings.cacheLimitGB ?? DEFAULT_CACHE_LIMIT_GB
  const clear = async () => {
    setClearing(true)
    await window.api.cache.clear()
    setClearing(false)
    measure()
  }
  return (
    <section className="setting">
      <h2>
        <label htmlFor="cache-limit">{t('settings.cacheLimit')}</label>
      </h2>
      <span className="muted small">{t('settings.cacheLimitHelp')}</span>
      <div className="field-row">
        <Dropdown
          id="cache-limit"
          value={String(limit)}
          options={CACHE_LIMITS_GB.map((gb) => ({ value: String(gb), label: gb ? `${gb} GB` : t('settings.cacheNoLimit') }))}
          onChange={(v: string) => onChange({ cacheLimitGB: Number(v) })}
          label={t('settings.cacheLimit')}
        />
        <button type="button" className="btn" onClick={() => void clear()} disabled={clearing}>
          {t('settings.cacheClear')}
        </button>
      </div>
      {usage && (
        <span className="muted small" role="status">
          {t('settings.cacheUsage', { downloads: formatBytes(usage.downloads), thumbs: formatBytes(usage.thumbs), other: formatBytes(usage.other) })}
        </span>
      )}
    </section>
  )
}
