import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
// Bundled (not from Google) so the app looks the same offline; all three cover Vietnamese.
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/be-vietnam-pro/700.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/app.css'
import { App } from './App'

// For scripts that check how many effects render at once (a contact sheet): one card, drawn as the grid draws it.
;(window as unknown as { assetHubRender: unknown }).assetHubRender = (repo: string, branch: string, root: string, path: string) =>
  import('./viewer/prefabThumb').then((m) => m.renderPrefabThumbnail({ repo, branch, root }, path))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
