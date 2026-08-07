# pieditor architecture

read_when:
- refactoring `src/index.ts`, `src/composition.ts`, or editor lifecycle wiring
- changing editor chrome or file-picker runtime/config behavior
- changing status-bar rendering, footer integration, or git invalidation
- adding another feature that wants to own `setEditorComponent()`

## Purpose

`pieditor` is a composite editor extension. It owns Pi's custom editor component and layers several UX features behind one `setEditorComponent()` integration so they stay compatible. Pi owns the surrounding TUI rendering in both regular and fullscreen modes.

Current feature areas:
- editor lifecycle + shortcut wiring
- `@` file picker
- `!` / `!!` shell completions
- top-border status bar
- raw clipboard paste via `alt+v`
- terminal bracketed double-paste expansion
- empty-editor double-submit continuation
- raw active prompt editor buffer copy via `alt+c` and `/copy-editor`
- optional double-escape command trigger
- slash-command remapping at submit time
- opt-in editor chrome style config

## Ownership boundaries

### `src/index.ts`
Thin extension entrypoint.
Owns:
- Pi event registration
- shortcut registration
- delegation into composition runtime

### `src/composition.ts`
Runtime wiring boundary.
Owns:
- active context/editor/footer refs
- attaching `EnhancedEditor`
- footer hookup
- preview highlighter warmup
- git invalidation triggers from tool/user bash events
- active prompt editor buffer copy readiness checks and clipboard writes

### `src/editor/*`
Editor behavior only.
Owns:
- submit interception and command remap
- scrolling detached fullscreen transcripts to the bottom immediately before forwarding each non-empty remapped submit
- double-escape timing/decision logic
- configured-submit detection and double-submit continuation state/frame rendering
- double-paste inspection/state and native marker confirmation through supported editor text APIs
- autocomplete wrapping
- status-bar insertion above the native editor border

### `src/file-picker/*`
Picker-specific UI and data flow.
Owns:
- file listing/filtering/preview/highlighting
- picker-local state and option toggles
- converting selections into `@path` refs

`src/file-picker/runtime.ts` creates the picker runtime explicitly. This preserves current effective behavior while avoiding import-time config/state initialization.

Copy-editor behavior reads `EnhancedEditor.getText()` from the active prompt editor only, never transcript output, selection text, footer/status text, or overlay UI contents. It warns when the editor is not ready, reports `Editor buffer empty` without writing the clipboard for an empty buffer, and otherwise copies raw text through the clipboard hook.

### `src/status-bar/*`
Status bar rendering.
Owns:
- context collection
- preset resolution
- segment rendering
- Amp chrome status layout extraction; Amp keeps non-path/git segments on the top border and relocates path/git segments to the bottom border
- git status helpers
- icon/theme helpers

The dedicated `caveman` segment is an integration point for the standalone `extensions/caveman` extension. It reads the generic extension status key `caveman` from footer data instead of importing caveman state directly.

### `src/shell/*`
Shell completion providers and shell detection.

## Event sources

- `session_start`
  - attach custom editor
  - attach footer listener
  - warm preview highlighting
- `tool_result`
  - invalidate git status after `write` / `edit`
  - invalidate git branch/state after branch-changing `bash` commands
- `user_bash`
  - invalidate git branch/state after branch-changing commands
- complete terminal bracketed-paste input received by `EnhancedEditor.handleInput()`
  - when `doublePaste.enabled` is true, let the first paste use native handling and arm only if observable before/after text proves Pi inserted a valid large-paste marker
  - consume a matching repeat within `doublePaste.windowMs` only if no draft edit occurred after arming; cursor-only movement preserves eligibility, but an edit cancels it permanently even if Undo restores the same draft fingerprint
  - expand all valid markers through `getExpandedText()` and supported Pi `setText()` only when the materialized output contains no paste-marker token that Pi could re-expand on submit; successful expansion moves the cursor to the end of the whole draft, even when the repeated marker was in the middle, and one Undo immediately afterward restores the previously collapsed marker draft
  - short, incomplete, mismatched, expired, edited, unsafe marker-like output, or failed expansion paths retain native paste behavior; failure warning is session-scoped
  - this shared path is compatible with Pi-owned regular and fullscreen rendering
- `alt+v`
  - paste raw clipboard text into the editor; it bypasses and does not participate in double-paste handling
- `alt+c`
  - copy the active prompt editor buffer as raw text through `composition.copyEditorBuffer()`
- `/copy-editor`
  - command-owned source for the same raw active prompt editor buffer copy path as `alt+c`

## Config layering

Primary config files:
- global: `~/.pi/agent/pieditor.json`
- project: `.pi/pieditor.json`

Merge order:
1. built-in defaults
2. global config
3. project config

Notes:
- `editorChrome.style: "amp"` changes editor borders only; it does not add Amp non-editor UI, color config, or other Amp features
- Amp chrome falls back to classic editor lines in very narrow terminals and renders an empty frame when status bar config is disabled
- `commandRemap` merges by key
- double-paste config merges by field; `enabled` defaults to `true` and `windowMs` defaults to `1000`
- editor chrome config merges by field; `style` defaults to `classic`, accepts `classic` or `amp`, and invalid values are ignored so lower layers/defaults apply
- file-picker config merges by field; `skipPatterns` is replaced by the last layer that sets it
- status-bar config merges by field; colors and nested segment options merge by semantic key / nested field

- obsolete `fixedEditor` keys are ignored

Pi `^0.84.0` is the minimum supported host. Pi owns regular/fullscreen viewport composition and TUI mode selection. Users choose official fullscreen through `/settings` or `--tui-mode fullscreen`; pieditor neither forces nor migrates that setting.

## Native preview fallback

Preview highlighting prefers the local Rust/N-API addon when configured for `native` mode.
Fallback order:
1. native addon
2. Pi built-in highlighting
3. plain preview text when highlighting is unavailable

Native highlighting is picker-preview-only. It does not change the rest of the editor.

## Compatibility rule

`pieditor` intentionally owns `setEditorComponent()`.
Do not enable other extensions that also replace the editor component at the same time unless they are merged into `pieditor` first.

Pi owns regular/fullscreen viewport composition. Pieditor must remain compatible with both modes and must not install a competing terminal compositor.

## Manual validation notes

- Run on Pi `^0.84.0` in regular mode and official fullscreen mode
- Switch modes through `/settings` and confirm editor, file picker, selectors, autocomplete, raw paste, and editor-buffer copy continue to work
- Launch with `--tui-mode fullscreen` and confirm pieditor does not alter the selected TUI mode
- Leave an obsolete `fixedEditor` key in config and confirm it has no effect
