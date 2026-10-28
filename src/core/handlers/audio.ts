import { resolveSelf } from '../deps/self'
import type { AssetTypeHandler } from '../types'

/** Audio files Unity imports as clips. AIFF and tracker modules are listed, though the preview may not play them. */
const AUDIO_EXT = /\.(wav|mp3|ogg|aiff?|mod|it|s3m|xm)$/i

/** Audio clips: played in the app with a waveform; taken as the file itself. */
export const audioHandler: AssetTypeHandler = {
  id: 'audio',
  labelKey: 'assetTypes.audio',
  badge: 'AUD',
  match: (entry) => AUDIO_EXT.test(entry.path),
  usesGuids: false,
  // Like textures: sound designers want the file, not a package.
  delivery: 'file',
  resolveDependencies: resolveSelf,
  preview: {
    kind: 'audio',
    // Played in the renderer; nothing to prepare here.
    load: async () => ({ status: 'unavailable', reasonKey: 'preview.renderer' })
  }
}
