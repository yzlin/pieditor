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
- optional editor chrome styling

## Domain model

- **Pi extension package**: npm package `@yzlin/pieditor`, loaded by Pi from `dist/index.js` after build.
- **Composite editor**: one owner for Pi's custom editor surface, implemented so feature areas do not compete over `setEditorComponent()`.
- **Composition runtime**: wiring layer that attaches the enhanced editor, footer listener, preview highlighter warmup, git invalidation, and copy-editor behavior.
- **Editor feature modules**: editor behavior, file picker, shell completions, status bar, and configuration readers live under `src/`.
- **Pi TUI host**: Pi `^0.84.0` owns regular/fullscreen rendering and the user's TUI mode choice.
- **Configuration**: global `~/.pi/agent/pieditor.json` plus project `.pi/pieditor.json`, layered over built-in defaults.
- **Native preview addon**: optional Rust/N-API syntect highlighter used only by picker previews when native preview mode is configured.

## Domain glossary

- **Enhanced editor**: the custom editor component owned by `pieditor`.
- **File picker**: the `@`-triggered overlay that selects files or folders and inserts `@path` references.
- **Status bar**: the top-border editor segment renderer with configurable presets, colors, and segment options.
- **Pi fullscreen mode**: official Pi-owned TUI mode selected by users through `/settings` or `--tui-mode fullscreen`; pieditor does not force or migrate it.
- **Command remap**: config map that rewrites slash commands at submit time while preserving arguments.
- **Copy editor**: `alt+c` / `/copy-editor` action that copies only the active prompt editor buffer as raw text; empty buffers are a no-op with an info notification.

## Product constraints

- `pieditor` intentionally owns `setEditorComponent()`; other editor-replacing extensions should not be enabled concurrently unless merged into `pieditor` first.
- Pi `^0.84.0` is the minimum supported host and exclusively owns regular/fullscreen viewport composition; pieditor must support either mode without changing the user's selection.
- Obsolete `fixedEditor` config is ignored.
- Keep upstream attribution to `w-winter/dot314` in `README.md` when updating this local extension.
- Native preview highlighting must fall back to Pi built-in highlighting and then plain preview text when unavailable.
- User-facing configuration behavior should stay documented in `README.md`; maintainer internals should stay under `docs/`.

## Open questions

- No source-grounded open questions currently captured.

## Context map

See `CONTEXT-MAP.md`.
