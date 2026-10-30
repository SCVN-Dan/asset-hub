# Asset Hub

Desktop app (Electron) for browsing Unity projects on GitHub: preview models, prefabs, VFX, textures, audio and fonts straight from a branch, collect what you need, and export it with every dependency (materials, textures, shaders, animations…) as a `.unitypackage`, checked against your own Unity project.

- [Install guide](docs/INSTALL.md)
- [Changelog](CHANGELOG.md)
- [Plan](docs/PLAN.md)
- [Roadmap & state](docs/ROADMAP.md)

## Run

```bash
npm install
npm run dev        # the app with hot reload
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # build into out/
```

Sign in with GitHub (GitHub CLI, installed by the app if missing, or a fine-grained token). The account needs read access to the asset repos.

## Release

```bash
npm run dist:web   # release/Asset-Hub-Installer.dmg (~1 MB) + Asset-Hub-arm64.zip (+ .sha256)
npm run release    # publishes v<version> to the public release repo ("releaseRepo" in package.json)
npm run dist       # (optional) full ~90 MB .dmg that installs without a network
```

The source repo stays private; only the built app goes to the public release repo, where the small installer downloads it from. See [docs/INSTALL.md](docs/INSTALL.md).

**Every installed copy updates itself from the release repo**, so publish only a build that has been tested and approved. Before `npm run release`: bump `version` in `package.json` and rename **Unreleased** in [CHANGELOG.md](CHANGELOG.md) to that version — its section becomes the release notes (the script refuses without one).

## Layout

```
src/
  core/            plain TypeScript, shared by main and renderer
    types.ts         TreeEntry, Asset, AssetTypeHandler, PreviewProvider…
    registry.ts      HandlerRegistry — the one place that knows the asset types
    handlers/        one handler per asset type (FBX, prefab, texture, audio…)
    github/          GitHub source: trees, files, Git LFS
    deps/            dependency resolution (prefab → models, materials, textures, scripts…)
    unity/           Unity YAML, .meta, particles, animation clips, imported IDs
    export/          .unitypackage writer, target-project checks, shader mapping, script stripping
    catalog/ search/ index of every branch and search over it
  shared/          settings, collections and IPC types shared by main/preload/renderer
  main/            Electron main process (window, auth, GitHub, export, caches)
  preload/         exposes window.api (contextIsolation + sandbox)
  renderer/        React UI
    src/i18n/        i18next, locales/en.json (default) + vi.json + ko.json
    src/screens/     SignIn (3D lobby), Browse, Settings
    src/components/  folder tree, asset cards and details, export bar, collections…
    src/viewer/      three.js viewers (models, prefabs, VFX, lobby scene)
```

**New asset type:** write an `AssetTypeHandler` in `src/core/handlers/`, register it in `createDefaultRegistry()` (`src/core/index.ts`) and add the `assetTypes.<id>` key to every locale file. Tabs, filters and the folder tree pick it up.

**New UI string:** add it to `en.json`, `vi.json` and `ko.json` — `locales.test.ts` fails when a key is missing.

## Install problems (dev)

**`Electron failed to install correctly`** — recent npm blocks postinstall scripts; `allowScripts` in `package.json` allows `electron` and `esbuild`. If it still fails (Electron's unzip can stop halfway on very new Node), unpack the cached zip by hand:

```bash
Z=$(find ~/Library/Caches/electron -name "electron-v*-darwin-*.zip" | head -1)
rm -rf node_modules/electron/dist && mkdir node_modules/electron/dist
ditto -x -k "$Z" node_modules/electron/dist
printf "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
```
