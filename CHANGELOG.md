# Changelog

What changed in each release of Asset Hub. `npm run release` publishes the section of the version in `package.json` as the release notes, so add each change under an **Unreleased** heading as it is made, and rename that heading to the version when releasing.

## [0.1.1] — 2026-10-30

### Added
- **Updates inside the app.** On every launch the app asks the release repo for the latest version; when there is a newer one, an **Update** button appears next to the version in the top bar. It downloads the new build, checks its SHA-256, replaces the app and restarts it. Settings and cache are kept. A copy that cannot replace itself (run from the .dmg, or from a folder the account cannot write to) opens the release page instead.
- The app's version is shown next to its name in the hub.
- **Remove scripts from prefabs** on export (on by default): the project's own script components (`.cs`, `.dll` in the repo) are removed from the prefab and all of its children, including scripts added to nested prefabs, and the script files are left out of the package. Unity and package components (UI, TextMeshPro…) are kept.

### Fixed
- The installer could not download the app (error code 3): the download address was not filled into the installer.
- The installer retries a dropped download up to 3 times, resuming where it stopped, and its error message shows curl's error code and message.
- Small font files (part of the Vietnamese characters) were blocked in the built app.
- At narrow widths the top bar keeps the Settings button visible: the app name gives way to the logo, and the update button has a fixed width.

### Changed
- README, install guide (`docs/INSTALL.md`, was `docs/CAI-DAT.md`) and release notes are in English.

## [0.1.0] — 2026-10-30

First release.

- Browse Unity projects on GitHub by repo and branch; preview FBX models, prefabs, VFX (particle systems), textures, sprites, materials, audio, animation clips and fonts.
- Search across every branch and repo, with a shared index.
- Collections and Favourites.
- Export a `.unitypackage` with all dependencies, checked against a target Unity project (files it already has, shaders by name, shader mapping, missing package scripts, URP version).
- Playable budget presets (5 MB / 2 MB / custom).
- Sign-in as a 3D game lobby; GitHub CLI installed by the app when missing.
- Languages: English, Vietnamese, Korean.
- Mac (Apple silicon) only; installed with a 1 MB web installer that downloads the app from GitHub Releases.
