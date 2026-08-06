# ADR: Use Pi fullscreen instead of pieditor fixed mode

- Status: accepted
- Date: 2026-08-06
- Deciders: unknown
- Supersedes: none
- Superseded by: none

## Context

Pieditor has an opt-in fixed editor compositor that owns terminal split rendering, scrolling, selector placement, and replacement-surface leases. Pi 0.84 adds an official `fullscreen` TUI mode with a fixed editor/status/footer dock. A crash was reported when running pieditor's compositor inside Pi's fullscreen mode because both layers try to own the viewport; this report was not independently reproduced as part of this migration.

Maintaining both implementations would duplicate terminal ownership and keep a conflict-prone compatibility path. Pieditor currently declares Pi `^0.80.0` peer dependencies and exports `@yzlin/pieditor/replacement-surface-lease`, which exists only to coordinate with its compositor.

## Decision

- Require `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` `^0.84.0`.
- Remove pieditor's fixed editor compositor, fixed-editor configuration, `/pieditor fixed-editor` command, and `./replacement-surface-lease` package export without a fallback or deprecation release.
- Leave TUI mode ownership entirely to Pi. Users enable fullscreen through Pi's `/settings` or `--tui-mode fullscreen`; pieditor does not force or migrate the setting.
- Ignore obsolete `fixedEditor` keys at runtime while removing them from pieditor's schema, examples, and documentation.
- Let `scripts/prepare-release.mjs` infer and apply the release version from the `Unreleased` changelog headings during the GitHub Actions release workflow; do not bump `package.json` directly during implementation.

## Consequences

- Pieditor no longer competes with Pi for terminal viewport ownership.
- Pi 0.80 through 0.83 are unsupported.
- Consumers of `@yzlin/pieditor/replacement-surface-lease` must remove that integration when upgrading.
- Existing `fixedEditor` config remains harmless but has no effect; schema-aware tooling marks it obsolete.
- Verification must cover pieditor in Pi 0.84 regular and fullscreen modes, live mode switching through `/settings`, and custom-editor flows including file picker, selectors, autocomplete, raw paste, and editor-buffer copy.
- The `Breaking` and `Removed` changelog sections cause the release workflow to infer a major version bump.

## Alternatives considered

- Keep Pi `^0.80.0` support and offer fullscreen only when the host provides it. Rejected because the supported contract would not consistently include official fullscreen.
- Retain the custom compositor as a fallback before Pi 0.84. Rejected because it preserves the crash-prone implementation and split ownership.
- Keep the replacement-surface lease export as a temporary or permanent no-op. Rejected because it leaves a misleading dead API.
- Migrate `fixedEditor.enabled` into Pi settings or force fullscreen. Rejected because Pi owns TUI mode and pieditor should not mutate that choice.
- Set the release version directly during implementation. Rejected because the release workflow owns version inference and mutation.
