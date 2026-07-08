# Changelog

All notable changes to Beacon Launcher are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Add changes under "Unreleased" as you work. When you cut a release:
  1. Move the "Unreleased" items into a new "## [x.y.z] - YYYY-MM-DD" section.
  2. Update the compare/tag links at the bottom.
  3. `npm version x.y.z && git push --follow-tags` to build & publish.
Group entries under: Added · Changed · Fixed · Removed · Security.
-->

## [Unreleased]

### Added

### Changed

### Fixed

## [0.3.0] - 2026-07-09

### Added

- Home page (shown when no profile is selected): total playtime plus a Modrinth **modpack browser**
  — search modpacks, open a project page with its full rendered description, and install one to
  create a profile.
- **Persistent logging** to `logs/launcher.log` (Settings → *Open logs folder*) covering installs,
  game output and errors, so failures can be diagnosed after the fact.
- Proper **localization** built on i18next, with correct plural forms (incl. Russian) and languages
  bundled from the [Translations](https://github.com/beacon-launcher/Translations) repository.
- Automatic **Java detection** on first run — an installed JDK is preferred over downloading one.
- A **Home** button at the top of the sidebar.
- Rendered (Markdown/HTML) project descriptions on content pages, matching how Modrinth shows them.

### Changed

- Modpack import now lives on the Home page instead of the New-profile dialog.
- Modrinth requests are cached and retried with backoff on rate limits (`429`).
- Download progress animates smoothly; each install phase is written to the log.
- Content and modpack detail pages are closed with the top-bar Back arrow (no in-page Back button).
- The monolithic stylesheet was split into per-component files.

### Fixed

- Escape cancels an in-progress profile rename (and an empty rename no longer commits).
- Switching language applies on the first click and updates every view.
- Tooltips no longer flicker when moving within an element and stay within the window.
- The sort control matches the search-box height and keeps a fixed width.

### Removed

- The rename icon in the Accounts modal.

## [0.2.0] - 2026-07-08

### Added

- Microsoft ("licensed") sign-in through a real Microsoft login window (OAuth authorization-code
  flow with PKCE) — unlocks premium/online-mode servers, your own skin and Realms.
- Multiple accounts: add several offline nicknames and licensed Microsoft accounts, then switch,
  rename or remove them from an accounts panel opened via the top-bar nickname.
- Colour theme setting: **System** (follows the OS), **Dark** or **Light**, with live preview cards.
- Minimalist custom tooltips across the app.

### Changed

- The top-bar nickname field is now an account switcher.
- The default accent adapts to the theme (dark accent on the light theme).
- Selection / active highlights use a neutral colour independent of the chosen accent.

### Security

- Microsoft refresh tokens are encrypted at rest via the OS keychain (Electron `safeStorage`).

## [0.1.0] - 2026-07-07

### Added

- Offline launcher: pick any Minecraft version (releases or snapshots) and Play — no accounts.
- Automatic download of client, libraries, assets, natives and the matching Java runtime.
- Mod-loader profiles: Vanilla, Fabric, Quilt, NeoForge, Forge (with Stable/Latest build choice).
- Modrinth content browser + installed-content manager (mods, resource packs, data packs, shaders)
  with per-item update checks, drag-and-drop install, and a minimal mod detail page.
- `.mrpack` modpack import (file picker or drag-and-drop).
- Windows-terminal-style log console.
- Cross-platform installers (Windows NSIS, macOS dmg/zip, Linux AppImage/deb) via electron-builder.
- In-app auto-update from GitHub Releases (electron-updater).

[Unreleased]: https://github.com/beacon-launcher/BeaconLauncher/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/beacon-launcher/BeaconLauncher/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/beacon-launcher/BeaconLauncher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/beacon-launcher/BeaconLauncher/releases/tag/v0.1.0
