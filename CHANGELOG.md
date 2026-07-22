# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking

- Require Node.js 24 or newer for package consumers.

### Added

- Add configurable double-paste expansion for large terminal bracketed pastes collapsed into Pi paste markers.
- Add `alt+c` and `/copy-editor` to copy the active prompt editor buffer as raw text.
- Render this extension's `ui.select()` and `ui.confirm()` prompts above the fixed editor while fixed editor mode is active.
- Lift Pi built-in selector components, such as `/model`, above the fixed editor while focused.
- Verify npm package contents with `npm pack --dry-run` before publishing releases.
- Add a default-on empty-editor double-submit gesture that sends literal `continue`, queues it as a follow-up while busy, and shows a warning-colored editor frame during the 500 ms armed window.
- Let interactive replacement surfaces optionally consume fixed-editor scroll input through `ReplacementSurface.handleReplacementScrollInput()`, while preserving root scrolling when the hook is absent or declines the input.

### Changed

- Keep editor popup rows, including slash-command autocomplete, above the fixed editor frame.
- Update release workflow GitHub Actions to current major versions and run npm publishing on Node.js 24.

### Fixed

- Fall back to compact status-bar segment text when narrow status rows overflow.

### Deprecated

### Removed

### Security
