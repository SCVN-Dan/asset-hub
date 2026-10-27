/// <reference types="vite/client" />
import type { AssetHubApi } from '@shared/ipc'

declare global {
  interface Window {
    api: AssetHubApi
  }
}
