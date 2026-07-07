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

[Unreleased]: https://github.com/beacon-launcher/launcher/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/beacon-launcher/launcher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/beacon-launcher/launcher/releases/tag/v0.1.0
