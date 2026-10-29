import { useCallback, useEffect, useMemo, useState } from 'react'
import { createDefaultRegistry, type AssetSource } from '@core/index'
import { MockAssetSource } from '@core/mock/mockSource'
import type { AuthStatus } from '@shared/ipc'
import { DEFAULT_EXPORT_LAYOUT, type Settings as AppSettings } from '@shared/settings'
import { budgetFor, DEFAULT_BUDGET_PRESET } from '@core/checks/playable'
import { BudgetContext } from './budget'
import i18n from './i18n'
import { RemoteAssetSource, RemoteError, unwrap } from './remoteSource'
import { Browse } from './screens/Browse'
import { Settings } from './screens/Settings'
import { SignIn } from './screens/SignIn'

type Screen = 'loading' | 'signin' | 'browse' | 'settings'

export function App() {
  const [settings, setSettings] = useState<AppSettings>()
  const [auth, setAuth] = useState<AuthStatus>()
  const [source, setSource] = useState<AssetSource>()
  const [screen, setScreen] = useState<Screen>('loading')
  const registry = useMemo(createDefaultRegistry, [])

  const enterGitHub = useCallback((status: AuthStatus) => {
    setAuth(status)
    setSource(new RemoteAssetSource())
    setScreen('browse')
  }, [])

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    // Restores the previous sign-in; any failure falls back to the sign-in screen.
    void window.api.auth.status().then((result) => {
      if (result.ok && result.data.signedIn) enterGitHub(result.data)
      else setScreen('signin')
    })
  }, [enterGitHub])

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

  const signOut = async () => {
    await window.api.auth.signOut()
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
          onToken={async (token) => enterGitHub(unwrap(await window.api.auth.signInWithToken(token)))}
          onGh={async () => {
            const existing = await window.api.auth.signInWithGh()
            if (existing.ok) return enterGitHub(existing.data)
            if (existing.error.code !== 'ghNotLoggedIn') throw new RemoteError(existing.error)
            // gh is installed but logged out: log it in through the browser right here.
            enterGitHub(unwrap(await window.api.auth.ghWebLogin()))
          }}
          onDemo={() => {
            setAuth(undefined)
            setSource(new MockAssetSource())
            setScreen('browse')
          }}
        />
      )
    case 'settings':
      return <Settings settings={settings} auth={auth} onChange={update} onSignOut={() => void signOut()} onBack={() => setScreen('browse')} />
    case 'browse':
      return source ? (
        <BudgetContext.Provider value={(settings.budgetPreset ?? DEFAULT_BUDGET_PRESET) === 'off' ? undefined : budgetFor(settings.budgetPreset, settings.customBudget)}>
        <Browse
          source={source}
          registry={registry}
          excludedFolders={settings.excludedFolders}
          login={auth?.login}
          initialRepo={source.isDemo ? undefined : settings.lastRepo}
          initialBranch={source.isDemo ? undefined : settings.lastBranch}
          onOpenBranch={(lastRepo, lastBranch) => {
            if (!source.isDemo && (lastRepo !== settings.lastRepo || lastBranch !== settings.lastBranch)) update({ lastRepo, lastBranch })
          }}
          onSettings={() => setScreen('settings')}
          budgetPreset={settings.budgetPreset ?? DEFAULT_BUDGET_PRESET}
          onBudgetPreset={(budgetPreset) => update({ budgetPreset })}
          exportLayout={settings.exportLayout ?? DEFAULT_EXPORT_LAYOUT}
          onExportLayout={(exportLayout) => update({ exportLayout })}
          targetProject={settings.targetProject}
        />
        </BudgetContext.Provider>
      ) : null
  }
}
