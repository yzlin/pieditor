# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking

- Require Node.js 24 or newer for package consumers.
- Require Pi `^0.84.0`; Pi 0.80 through 0.83 are no longer supported.
- Remove the `@yzlin/pieditor/replacement-surface-lease` package export; consumers must remove that integration.

### Added

- Add configurable double-paste expansion for large terminal bracketed pastes collapsed into Pi paste markers.
- Add `alt+c` and `/copy-editor` to copy the active prompt editor buffer as raw text.
- Verify npm package contents with `npm pack --dry-run` before publishing releases.
- Add a default-on empty-editor double-submit gesture that sends literal `continue`, queues it as a follow-up while busy, and shows a warning-colored editor frame during the 500 ms armed window.

### Changed

- Use Pi-owned regular/fullscreen rendering. Users choose official fullscreen through `/settings` or `--tui-mode fullscreen`; pieditor does not force or migrate the setting.
- Update release workflow GitHub Actions to current major versions and run npm publishing on Node.js 24.

### Fixed

- Propagate file-picker overlay focus to its search input for correct IME cursor positioning.
- Scroll detached Pi fullscreen transcripts to the bottom when submitting a non-empty editor message.
- Fall back to compact status-bar segment text when narrow status rows overflow.

### Deprecated

### Removed

- Remove pieditor's custom fixed editor mode, `fixedEditor` configuration support, `/pieditor fixed-editor` command, and terminal compositor. Obsolete `fixedEditor` keys are ignored; remove them and migrate to Pi's official fullscreen mode.
- Remove replacement-surface lease internals along with the public lease export.

### Security
