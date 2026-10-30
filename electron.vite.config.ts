import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { version } from './package.json'

/** Fonts come as .woff2 and .woff; Electron's Chromium always takes the .woff2, so the .woff files are left out of the build. */
function dropWoff(): Plugin {
  return {
    name: 'drop-woff',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) if (name.endsWith('.woff')) delete bundle[name]
    }
  }
}

const alias = {
  '@core': resolve('src/core'),
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  renderer: {
    resolve: { alias },
    // Shown next to the name in the hub.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), dropWoff()]
  }
})
