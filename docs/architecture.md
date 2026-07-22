# pieditor architecture

read_when:
- refactoring `src/index.ts`, `src/composition.ts`, or editor lifecycle wiring
- changing editor chrome or file-picker runtime/config behavior
- changing status-bar rendering, footer integration, or git invalidation
- adding another feature that wants to own `setEditorComponent()`

## Purpose

`pieditor` is a composite editor extension. It owns Pi's custom editor surface and layers several UX features behind one `setEditorComponent()` integration so they stay compatible.

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
- opt-in fixed editor runtime/config command surface

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
- fixed editor compositor lifecycle when `fixedEditor.enabled` is true
- active prompt editor buffer copy readiness checks and clipboard writes

### `src/editor/*`
Editor behavior only.
Owns:
- submit interception and command remap
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

### `src/fixed-editor/*`

Fixed editor rendering/compositor helpers only.
Owns:
- fixed editor cluster rendering primitives
- terminal split compositor primitives
- root scrollback visual scrollbar decoration: one rightmost-column gutter, dim gray `█` track, bright white `█` thumb
- above-editor lease surfaces used for fixed-mode transient UI, including the local `ui.select()` / `ui.confirm()` shim
- optional scroll-input delegation to interactive replacement-lease surfaces, with render-only surfaces retaining fixed-editor root scrolling

Runtime lifecycle installation, send-triggered root scrollback bottom jumps, and `ui.select()` / `ui.confirm()` shim wiring are owned by `src/composition.ts` when that integration is enabled. The shim is scoped to this extension context, only takes over while the fixed compositor is installed, and falls back to Pi's original prompt methods otherwise.

Copy-editor behavior is also owned by `src/composition.ts`. It reads `EnhancedEditor.getText()` from the active prompt editor only, never transcript output, selection text, footer/status text, or replacement/overlay UI contents. It warns when the editor is not ready, reports `Editor buffer empty` without writing the clipboard for an empty buffer, and otherwise copies raw text through the same clipboard hook used by fixed-editor selection copy.

The fixed editor compositor also lifts focused renderable TUI components above the fixed editor when Pi swaps them into the editor slot and their `render` method can be safely hidden. This covers Pi built-in selectors such as `/model` and extension custom components such as `/review`; keep this covered by compositor tests.

Editor popup rows, including slash-command autocomplete rows appended after the editor border, are reordered above the fixed editor frame in `src/fixed-editor/cluster.ts`. Preserve this ordering when changing editor row budgeting.

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
- `message_start`
  - jump fixed-editor root scrollback to bottom when a user message starts
- `input`
  - jump fixed-editor root scrollback to bottom for busy interactive input before Pi queues the follow-up
- complete terminal bracketed-paste input received by `EnhancedEditor.handleInput()`
  - when `doublePaste.enabled` is true, let the first paste use native handling and arm only if observable before/after text proves Pi inserted a valid large-paste marker
  - consume a matching repeat within `doublePaste.windowMs` only if no draft edit occurred after arming; cursor-only movement preserves eligibility, but an edit cancels it permanently even if Undo restores the same draft fingerprint
  - expand all valid markers through `getExpandedText()` and supported Pi `setText()` only when the materialized output contains no paste-marker token that Pi could re-expand on submit; successful expansion moves the cursor to the end of the whole draft, even when the repeated marker was in the middle, and one Undo immediately afterward restores the previously collapsed marker draft
  - short, incomplete, mismatched, expired, edited, unsafe marker-like output, or failed expansion paths retain native paste behavior; failure warning is session-scoped
  - this shared path applies in normal and fixed rendering modes
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
- `editorChrome.style: "amp"` changes editor borders only, including fixed-editor mode; it does not add Amp non-editor UI, color config, or other Amp features
- Amp chrome falls back to classic editor lines in very narrow terminals and renders an empty frame when status bar config is disabled
- `commandRemap` merges by key
- double-paste config merges by field; `enabled` defaults to `true` and `windowMs` defaults to `1000`
- editor chrome config merges by field; `style` defaults to `classic`, accepts `classic` or `amp`, and invalid values are ignored so lower layers/defaults apply
- file-picker config merges by field; `skipPatterns` is replaced by the last layer that sets it
- fixed-editor config merges by field; shortcut arrays are replaced by the last layer that sets them
- status-bar config merges by field; colors and nested segment options merge by semantic key / nested field

Fixed editor is opt-in: `fixedEditor.enabled` defaults to `false`. `/pieditor fixed-editor [on|off|toggle|status]` updates the live runtime and persists only the global `fixedEditor.enabled` value. If project `.pi/pieditor.json` defines `fixedEditor.enabled`, it still wins on the next load; the command warns after saving global state and `status` reports the active project override.

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

Fixed editor mode also owns terminal split composition. Do not enable it alongside `pi-powerline-footer`'s fixed editor mode; both install fixed editor compositors and will conflict.

## Manual validation notes

- Boot with default config and confirm fixed editor mode is off
- Use `/pieditor fixed-editor on|off|toggle|status` and confirm live runtime state plus global config persistence
- Verify mouse wheel and configured shortcut scrolling while fixed editor mode is enabled
- Confirm fixed editor root scrollback shows the one-column visual scrollbar and returns to bottom on user-message start or follow-up queue update
- Add a project `fixedEditor.enabled` override and confirm it wins over global config on reload
