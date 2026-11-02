import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { displayName } from '@shared/displayName'
import { createDefaultRegistry, type AssetSource } from '@core/index'
import type { AuthStatus } from '@shared/ipc'
import { DEFAULT_EXPORT_LAYOUT, type Settings as AppSettings } from '@shared/settings'
import { budgetFor, DEFAULT_BUDGET_PRESET } from '@core/checks/playable'
import { BudgetContext } from './budget'
import i18n from './i18n'
import { RemoteAssetSource, RemoteError, unwrap } from './remoteSource'
import { Browse } from './screens/Browse'
import { Settings } from './screens/Settings'
import { AiPet } from './components/AiPet'
import { SignIn } from './screens/SignIn'

type Screen = 'loading' | 'signin' | 'browse' | 'settings'

/** After the chest opens: the white-out fades into the hub and greets the user. */
function Welcome({ login, onDone }: { login?: string; onDone(): void }) {
  const { t } = useTranslation()
  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200)
    return () => window.clearTimeout(timer)
  }, [onDone])
  return (
    <div className="welcome" aria-live="polite">
      <div className="welcome-flash" aria-hidden="true" />
      <div className="welcome-toast" role="status">
        <span aria-hidden="true">★</span>
        {login ? t('signin.welcome', { login: displayName(login) }) : t('signin.welcomeAnon')}
      </div>
    </div>
  )
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>()
  const [auth, setAuth] = useState<AuthStatus>()
  const [source, setSource] = useState<AssetSource>()
  const [screen, setScreen] = useState<Screen>('loading')
  /** Set when the user just came in through the lobby: the greeting over the hub. */
  const [welcome, setWelcome] = useState<{ login?: string }>()
  /** Signed in from last time: the lobby opens the chest by itself, then the hub. */
  const [autoEnter, setAutoEnter] = useState<AuthStatus>()
  const endWelcome = useCallback(() => setWelcome(undefined), [])
  const registry = useMemo(createDefaultRegistry, [])

  const enterGitHub = useCallback((status: AuthStatus) => {
    setAuth(status)
    setSource(new RemoteAssetSource())
    setScreen('browse')
  }, [])

  /** The lobby shows at once; its sign-in buttons wait until the previous sign-in is checked. */
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    setScreen('signin')
    // Restores the previous sign-in; any failure falls back to the sign-in buttons.
    void window.api.auth.status().then((result) => {
      if (result.ok && result.data.signedIn) setAutoEnter(result.data)
      setChecking(false)
    })
  }, [enterGitHub])

  // While the chest opens, the last branch's file list loads, so the hub fills as soon as it shows.
  const resumeRepo = autoEnter ? settings?.lastRepo : undefined
  const resumeBranch = autoEnter ? settings?.lastBranch : undefined
  useEffect(() => {
    if (resumeRepo && resumeBranch) void window.api.source.listTree(resumeRepo, resumeBranch)
  }, [resumeRepo, resumeBranch])

  useEffect(() => {
    if (!settings) return
    void i18n.changeLanguage(settings.language)
    document.documentElement.lang = settings.language
  }, [settings])

  const update = useCallback((patch: Partial<AppSettings>) => {
    void window.api.setSettings(patch).then(setSettings)
  }, [])

  if (!settings || screen === 'loading') return null

  const setLanguage = (language: AppSettings['language']) => update({ language })

  const signOut = async (gh = false) => {
    await window.api.auth.signOut({ gh })
    setAuth(undefined)
    setSource(undefined)
    setScreen('signin')
  }

  switch (screen) {
    case 'signin':
      return (
        <SignIn
          language={settings.language}
          onLanguage={setLanguage}
          onToken={async (token) => unwrap(await window.api.auth.signInWithToken(token))}
          onGh={async () => {
            const existing = await window.api.auth.signInWithGh()
            if (existing.ok) return existing.data
            if (existing.error.code !== 'ghNotLoggedIn') throw new RemoteError(existing.error)
            // gh is installed but logged out: log it in through the browser right here.
            return unwrap(await window.api.auth.ghWebLogin())
          }}
          autoEnter={autoEnter}
          checking={checking}
          onEnter={(status) => {
            setAutoEnter(undefined)
            setWelcome({ login: status.login })
            enterGitHub(status)
          }}
        />
      )
    case 'settings':
      return <Settings settings={settings} auth={auth} onChange={update} onSignOut={(gh) => void signOut(gh)} onBack={() => setScreen('browse')} />
    case 'browse':
      return source ? (
        <BudgetContext.Provider value={(settings.budgetPreset ?? DEFAULT_BUDGET_PRESET) === 'off' ? undefined : budgetFor(settings.budgetPreset, settings.customBudget)}>
        <Browse
          source={source}
          registry={registry}
          excludedFolders={settings.excludedFolders}
          login={auth?.login}
          initialRepo={settings.lastRepo}
          initialBranch={settings.lastBranch}
          onOpenBranch={(lastRepo, lastBranch) => {
            if (lastRepo !== settings.lastRepo || lastBranch !== settings.lastBranch) update({ lastRepo, lastBranch })
          }}
          onSettings={() => {
            // The greeting belongs to arriving from the lobby: leaving the hub ends it, or coming back would flash it again.
            setWelcome(undefined)
            setScreen('settings')
          }}
          budgetPreset={settings.budgetPreset ?? DEFAULT_BUDGET_PRESET}
          onBudgetPreset={(budgetPreset) => update({ budgetPreset })}
          exportLayout={settings.exportLayout ?? DEFAULT_EXPORT_LAYOUT}
          onExportLayout={(exportLayout) => update({ exportLayout })}
          targetProject={settings.targetProject}
          collections={settings.collections}
          onCollections={(collections) => update({ collections })}
          recent={settings.recent}
          onRecent={(recent) => update({ recent })}
          watched={settings.watched ?? []}
          onWatched={(watched) => update({ watched })}
        />
        <AiPet language={settings.language} enabled={settings.aiPet !== false} />
        {welcome && <Welcome login={welcome.login} onDone={endWelcome} />}
        </BudgetContext.Provider>
      ) : null
  }
}
