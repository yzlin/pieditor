# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking

- Require Node.js 24 or newer for package consumers.

### Added

- Render this extension's `ui.select()` and `ui.confirm()` prompts above the fixed editor while fixed editor mode is active.
- Lift Pi built-in selector components, such as `/model`, above the fixed editor while focused.
- Verify npm package contents with `npm pack --dry-run` before publishing releases.

### Changed

- Keep editor popup rows, including slash-command autocomplete, above the fixed editor frame.
- Update release workflow GitHub Actions to current major versions and run npm publishing on Node.js 24.

### Fixed

### Deprecated

### Removed

### Security
