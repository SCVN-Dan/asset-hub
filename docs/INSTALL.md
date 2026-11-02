# Installing Asset Hub on a Mac

## 1. Requirements

A Mac with Apple silicon (**M1, M2, M3, M4**) — check under  (top left of the screen) › **About This Mac** › **Chip**. Intel Macs are not supported. A network connection is needed to download the app (~90 MB) during install.

## 2. Install

1. Download **`Asset-Hub-Installer.dmg`** (about 1 MB) and open it.
2. Open **Install Asset Hub** (the installer) in the window that appears.
3. **The first time**, macOS blocks the installer because it is not notarized by Apple — allow it once:
   - **macOS 15 (Sequoia) or later:** click **Done** on the warning → open **System Settings** › **Privacy & Security**, scroll to the bottom, click **Open Anyway** next to *"Install Asset Hub was blocked…"* → enter your password → **Open**.
   - **macOS 14 (Sonoma) or earlier:** **right-click** **Install Asset Hub** › **Open** → **Open**.
4. Click **Install**. The installer downloads the latest version from GitHub (with a progress bar), verifies the file, installs it into **Applications** and opens Asset Hub. An app installed this way opens directly, without being blocked.

New version: run **Install Asset Hub** again — it downloads the latest version and replaces the old one.

## 3. Sign in

Click **START**. If the Mac has no GitHub CLI, the app downloads it (no admin rights needed). GitHub asks you to confirm with a **room code**: click **Open GitHub**, paste the code (already copied), click **Continue** then **Authorize**, and go back to the app — done. From then on the app opens straight into the hub.

Your GitHub account must be invited to the company organization and have read access to the asset repos.

## Uninstall

Drag **Asset Hub** from Applications to the Trash. Downloaded data and thumbnails are in `~/Library/Application Support/asset-hub` — delete that folder for a clean removal (or use **Settings › Cache › Clear** in the app first).

---

## For developers

```sh
npm run dist:web    # release/Asset-Hub-Installer.dmg (~1 MB) + Asset-Hub-arm64.zip (+ .sha256)
npm run release     # publishes v<version> to GitHub Releases of the public repo in package.json "releaseRepo"
npm run dist        # (optional) full ~90 MB .dmg, no network needed to install
```

- Installer: `scripts/installer.applescript` (compiled with `osacompile` in `scripts/make-web-installer.mjs`). It downloads `releases/latest/download/Asset-Hub-arm64.zip` and installs it only when it matches the SHA-256 published with it.
- Config: `electron-builder.yml`, Apple silicon only. The app is signed **ad hoc** (`scripts/adhoc-sign.cjs`); with an Apple Developer ID it can be signed and notarized properly, which removes the "allow" step above.
- Bump `version` in `package.json` before each release (tag `v<version>`).
