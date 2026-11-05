// electron-builder afterPack hook, macOS: trims Electron's UI languages to the app's own and drops
// SwiftShader (Chromium's CPU fallback for WebGL when the GPU cannot be used: 16 MB, and every M1–M4
// has a GPU WebGL runs on), then signs the
// packed .app ad hoc ("-", no certificate). Apple Silicon refuses to run unsigned code, and packing
// (asar, Info.plist) breaks the signature Electron ships with. A real Developer ID replaces this later.
const { execFileSync } = require('node:child_process')
const { readdirSync, rmSync } = require('node:fs')
const path = require('node:path')

/** Same as `electronLanguages` in electron-builder.yml, which leaves the framework's own copies in place. */
const KEEP = new Set(['en', 'vi', 'ko'])

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const resources = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Resources')
  for (const name of readdirSync(resources)) {
    if (name.endsWith('.lproj') && !KEEP.has(name.replace(/\.lproj$/, ''))) rmSync(path.join(resources, name), { recursive: true })
  }
  const libraries = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Libraries')
  for (const name of ['libvk_swiftshader.dylib', 'vk_swiftshader_icd.json']) rmSync(path.join(libraries, name), { force: true })
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
