# Changelog

What changed in each release of Asset Hub. `npm run release` publishes the section of the version in `package.json` as the release notes, so add each change under an **Unreleased** heading as it is made, and rename that heading to the version when releasing.

## [0.1.2] — 2026-10-31

### Added
- **Watch a branch:** the 👁 next to the branch picker follows it. On opening the app, every 30 minutes and on coming back to it, the app asks GitHub (read only) which asset files were added since you last marked it seen: the sidebar's **Watching** list shows the count per branch, new cards carry a **NEW** badge, and a banner offers "Only new assets" and "Mark all seen". Moved or renamed files do not count as new.
- **Import into Unity:** a button next to Export (asset details, cross-branch results, the chest, several picked cards) opens the package straight in an open Unity editor, which shows its import dialog — no file to save or drag. With several projects open, an arrow lists them (project and Unity version) and the one used last is remembered. The package is compared with that editor's project, so what it already has is left out.
- **Pick several cards:** Cmd/Ctrl-click picks cards one by one, Shift-click a run of them; a bar then adds them all to the chest or a collection, or imports them into Unity.
- **Keyboard shortcuts:** ⌘K search, ⌘A pick every card, Esc clear the picks, F favourite, E chest, ⌘I import into Unity (the project used last), ⌘J the AI pet; `?` lists them.
- **Recent:** "Viewed lately" and "Exported lately" in the sidebar (30 each, newest first), opened like a collection from any repo or branch.
- **Quick filters:** ≤ 500 KB, ≤ 5k tris and "With animation" chips above the grid; the ones on measurements keep measured assets only.
- AI pet: `name_words` shows it the words file names in a repo are really made of, so a description in Vietnamese finds the asset on the first try (30/30 on a set of real requests across pizza, crablife and smashdown, 17 s on average, no questions back). A 👎 on an answer saves the conversation on this Mac (`ai-feedback/`) to test the pet against later.
- **AI assistant, step 1: connect ChatGPT** (Settings › AI assistant). The app downloads Codex once (pinned 0.165.0, about 125 MB — codex and its code-mode host, each checked against its SHA-256; an identical copy already on the Mac is reused) and signs in with the user's own ChatGPT account in the browser — no API key. Codex runs with its own settings folder, apart from any Codex the user has. The chat itself comes next.
- **AI pet:** once ChatGPT is connected, the chest sits in the hub's bottom-right corner; click it for a small chat bubble. Answers are kept to one or two short sentences and stream in as they are written; Stop ends an answer, + starts a new chat, Esc closes the bubble. The conversation survives going to Settings and back. Settings › AI assistant has a switch to hide the pet.
- **The pet works in the hub:** it searches (filling the search box and the type tab, in the open branch or every repo), opens an asset with its preview, tells its size, measurements, playable budget and dependencies, and adds assets to the chest or a collection when asked. While it works the bubble says what it is doing ("Searching…"). Exporting stays a button for the user.
- **Reply buttons in the pet:** asked to find something without saying where, the pet offers **This branch · All branches · Other…** (Other lets you type, e.g. "every repo"); other unclear requests get 2–4 buttons too. It asks at most once per request, and not when you already said it ("find smoke in every repo" searches straight away). Search covers the open branch, every branch of the repo, or every repo; naming a repo ("in repo pizza") opens it and searches all its branches without a question — a whole word of a repo's name wins over a part of one (pizza → luna_pizza, not luna_pizzasimulator). The bubble is wider and reply buttons wrap, always in view. The pet turns Vietnamese words into the English names files would have and searches them all at once ("máy cắt lúa" → `harvester | combine | reaper | tractor | farm machine`), so it finds things on the first try.
- Search box: `a | b | c` finds assets matching any of the alternatives (each alternative still needs all of its words), best matches first.
- The assistant cannot change anything outside Asset Hub: Codex starts with shell, terminals, ChatGPT apps/connectors, browser and computer use, plugins, hooks, image tools and web search turned off, in a read-only sandbox that never asks for more. Tested by asking it outright to read `~/.zshrc`, run `ls`, write a file and fetch a web page: every attempt failed.
- **Read-only towards GitHub, enforced:** every request to GitHub passes one check before it is sent — reads (GET, HEAD, GraphQL queries, Git LFS downloads) go through; anything that could change a repo (PUT, PATCH, DELETE, other POSTs, GraphQL mutations, LFS uploads) is refused on the Mac, whatever asked for it, including the assistant later.
- Sign-in screen: the chest answers the START button — hovered or focused, it rattles, its lid lifts a little and the gold inside glows, with four-pointed blings sparkling on it.
- Sign-in screen sounds, made in the app (no sound files): a click on START, and a rattle, knock, creak and chime as the chest opens. A speaker button next to the languages mutes them; the choice is remembered.
- The version is shown at the bottom right of the sign-in screen, with the **Update** button when a newer release exists.
- **Sign out of GitHub** from Settings › Account: signing out can also log the account out of GitHub CLI on this Mac (on by default), so the next START signs in through the browser again and another account can be chosen. The button is red, and the Settings button in the top bar says it holds the account.

### Changed
- Icon buttons carry a short word (Export, Chest, Unity, Collection, Path, GitHub, Link, Watch); Unity's button shows the Unity cube and its arrow lines up with it. Dependencies are drawn as a tree (├ └) so nested textures read as belonging to their material.
- **Calmer hub.** The grid header is two rows: scope, then sort and one **Filters** button (quick filters, playable budget, merge identical files, clips without a model) with a count, and pills for what is on; thumbnail loading is a thin bar. The chest folds to one line (count, room left, size, Unity, Export) and opens for its list and options. In the details panel the viewer's controls appear on hover, actions are one row of icons (Export, Chest, Import into Unity, Favourite, Collection, then copy path / GitHub / link), and Dependency, Particles, prefab uses and copies fold with a summary line ("9 files · 1 warning"); stats left at zero are not listed. Sidebar groups (Watching, Recent, Collections, Folders) fold too; every fold is remembered.
- **One icon family** drawn for the app (same grid and stroke): export, import into Unity, the chest, star, collection, bell for watching (was an eye), clock and package for recent lists, filter, copy, external, link — replacing emoji and text glyphs.
- Names are shown without the company prefix: "SCVN-Dan" or "SC-Dan" reads "Dan" in the top bar, the greeting and Settings.
- Explanatory lines removed across the app (Settings help texts, the AI assistant's intro, the gh sign-out hint, the sign-in screen's email/SSO/install notes, the catalog's folder note); labels and controls speak for themselves. Status and warnings stay.
- Sign-in screen: the line "Sign in with your GitHub account" under START and the "Reads repos only · token kept in this Mac's Keychain" footer are gone.

### Fixed
- Export to a target project now warns when packed materials use a shader that project cannot read — not in the package and not in the project, or a custom importer's file (Toony Colors Pro `.tcp2shader`) where that plugin is missing: those materials would turn magenta. Found by importing into a real Unity project.
- Shaders of custom importers (any `*shader` extension, e.g. `.tcp2shader`) are found by GUID and packed beside their includes (they were left out, or put in Other/ away from the `.cginc` they include). Stored GUID indexes are rebuilt once for this.
- Import into Unity no longer opens an empty package when the project already has everything; it says so instead.
- Unity editors are named by their project folder (a copied project could show another project's productName).
- Going back to the hub from Settings no longer replays the lobby's white flash (it happened when Settings was opened during the greeting); the hub and Settings now switch with a short, soft fade.
- A card reached with the arrow keys had a bigger frame than a clicked one; both now have the same frame.

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
