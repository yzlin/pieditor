# CONTEXT

## Product purpose

`pieditor` is a Pi editor extension that composes multiple custom-editor UX features behind one editor integration so they remain compatible.

Current user-facing feature areas include:
- top-border status bar
- `@` file picker and preview pane for inserting `@path` references
- `!` / `!!` shell completions
- raw clipboard paste via `alt+v`
- raw active prompt editor buffer copy via `alt+c` and `/copy-editor`
- optional double-escape command trigger
- slash-command remapping at submit time
- optional fixed editor mode and editor chrome styling

## Domain model

- **Pi extension package**: npm package `@yzlin/pieditor`, loaded by Pi from `dist/index.js` after build.
- **Composite editor**: one owner for Pi's custom editor surface, implemented so feature areas do not compete over `setEditorComponent()`.
- **Composition runtime**: wiring layer that attaches the enhanced editor, footer listener, preview highlighter warmup, git invalidation, copy-editor behavior, and fixed-editor lifecycle.
- **Editor feature modules**: editor behavior, file picker, shell completions, status bar, fixed editor helpers, and configuration readers live under `src/`.
- **Configuration**: global `~/.pi/agent/pieditor.json` plus project `.pi/pieditor.json`, layered over built-in defaults.
- **Native preview addon**: optional Rust/N-API syntect highlighter used only by picker previews when native preview mode is configured.

## Domain glossary

- **Enhanced editor**: the custom editor component owned by `pieditor`.
- **File picker**: the `@`-triggered overlay that selects files or folders and inserts `@path` references.
- **Status bar**: the top-border editor segment renderer with configurable presets, colors, and segment options.
- **Fixed editor mode**: opt-in mode that reserves a root scrollback viewport and visual scrollbar while keeping manual scrollback available.
- **Command remap**: config map that rewrites slash commands at submit time while preserving arguments.
- **Copy editor**: `alt+c` / `/copy-editor` action that copies only the active prompt editor buffer as raw text; empty buffers are a no-op with an info notification.
- **Replacement-surface lease**: integration point for internal local extensions that temporarily replace the editor/custom UI surface so fixed editor mode can stand down.

## Product constraints

- `pieditor` intentionally owns `setEditorComponent()`; other editor-replacing extensions should not be enabled concurrently unless merged into `pieditor` first.
- Fixed editor mode also owns terminal split composition and conflicts with `pi-powerline-footer` fixed editor mode.
- Keep upstream attribution to `w-winter/dot314` in `README.md` when updating this local extension.
- Native preview highlighting must fall back to Pi built-in highlighting and then plain preview text when unavailable.
- User-facing configuration behavior should stay documented in `README.md`; maintainer internals should stay under `docs/`.

## Open questions

- No source-grounded open questions currently captured.

## Context map

See `CONTEXT-MAP.md`.
