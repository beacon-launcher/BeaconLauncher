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

[Unreleased]: https://github.com/beacon-launcher/launcher/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/beacon-launcher/launcher/releases/tag/v0.1.0
