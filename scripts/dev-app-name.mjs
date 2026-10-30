// Under `npm run dev`, macOS names the app after the Electron.app bundle it runs in
// ("Electron" in the menu bar and the Dock): app.setName() cannot change that.
// This renames that development copy; a packaged app gets its name from the build (Phase 10).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NAME = 'Asset Hub'

if (process.platform === 'darwin') {
  const plist = fileURLToPath(new URL('../node_modules/electron/dist/Electron.app/Contents/Info.plist', import.meta.url))
  if (existsSync(plist)) {
    const read = (key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).toString().trim()
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      if (read(key) !== NAME) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${NAME}`, plist])
    }
  }
}
