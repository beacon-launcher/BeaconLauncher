# Beacon Launcher

[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/beacon-launcher/BeaconLauncher?display_name=tag&sort=semver)](https://github.com/beacon-launcher/BeaconLauncher/releases/latest)
[![Build](https://github.com/beacon-launcher/BeaconLauncher/actions/workflows/release.yml/badge.svg)](https://github.com/beacon-launcher/BeaconLauncher/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/beacon-launcher/BeaconLauncher/total)](https://github.com/beacon-launcher/BeaconLauncher/releases)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

A dead-simple, open-source **offline** Minecraft launcher. Pick a version, type a
username, press Play. No Microsoft login, no accounts — Beacon downloads the game
straight from Mojang and launches it.

Built with Electron + React + TypeScript, using [`@xmcl`](https://github.com/Voxelum/minecraft-launcher-core-node)
for downloading and launching.

> Beacon never bundles Minecraft — the game files are downloaded from Mojang at
> runtime, exactly like every other launcher.

## Features

- Browse and launch any Minecraft version (releases, or snapshots via the toggle).
- Downloads the client jar, libraries, assets and natives automatically.
- Offline account (a stable offline UUID is derived from your username).
- Configurable game directory, Java path, and memory.
- Live game log console.

## Requirements

- **Node.js 18+** (to build/run from source).
- A **Java** runtime to actually launch the game:
  - Minecraft ≤ 1.16 → Java 8
  - 1.17 – 1.20.4 → Java 17+
  - 1.20.5+ → Java 21+

  Set the Java path in **Settings** if the version you pick needs a different JDK
  than the one on your `PATH`.

## Develop

```bash
npm install
npm run dev        # launches the app with hot reload
```

Other scripts:

```bash
npm run typecheck  # type-check without emitting
npm run build      # bundle main/preload/renderer into ./out
npm run dev:web    # run just the renderer in a browser (mocked backend, for UI work)
```

## Build installers

Beacon packages with [electron-builder](https://www.electron.build/) into native
installers for each OS. The app must be bundled first (`electron-vite build`); each
script below does that for you.

```bash
npm run build:win     # Windows  → dist/Beacon Launcher-<version>-Setup.exe (NSIS)
npm run build:mac     # macOS    → dist/*.dmg + *.zip  (x64 + arm64)
npm run build:linux   # Linux    → dist/*.AppImage + *.deb
npm run pack          # unpacked app in dist/ (quick smoke test, no installer)
```

Output lands in `dist/`. You can only build macOS installers on a Mac, so use CI
(below) to produce all three from any machine.

> **Windows note:** a full local build needs symlink permission — enable *Developer
> Mode* (Settings → Privacy & security → For developers) or run the terminal as
> Administrator, otherwise electron-builder fails unpacking its code-sign helper.
> CI is unaffected. To **quick-test the installer without that permission** (the app
> window icon still works; only the `.exe` file icon falls back to the default):
>
> ```bash
> npx electron-builder --win --config.win.signAndEditExecutable=false
> ```

Builds are **unsigned** — Windows SmartScreen and macOS Gatekeeper will warn on
first launch (right-click → Open on macOS; "More info → Run anyway" on Windows).

## Versioning & releases

The launcher version is `package.json → version` (shown in **Settings → About** and
used for update checks).

Releases are automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml):
push a `v*` tag and CI builds Windows/macOS/Linux installers on their native runners
and publishes them to the matching GitHub Release.

```bash
npm version patch          # bump 0.1.0 → 0.1.1 and create a "v0.1.1" commit + tag
git push --follow-tags     # push the commit and the tag → CI builds + publishes
```

## Auto-update

Once installed, Beacon checks its GitHub Releases for a newer version a few seconds
after launch (and on demand via **Settings → Check for updates**). When one is found,
an **Update** pill appears in the title bar:

- **Windows / Linux** — click to download in place, then **Restart to update**.
- **macOS** — unsigned builds can't self-apply, so it opens the
  [Releases page](https://github.com/beacon-launcher/BeaconLauncher/releases) to download
  the new `.dmg` manually.

Update source is configured in [`electron-builder.yml`](./electron-builder.yml)
(`publish: github → beacon-launcher/BeaconLauncher`).

## License

[GPL-3.0-or-later](./LICENSE) — © 2026 Beacon Launcher.
