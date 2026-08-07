# pieditor

A composite custom editor that combines several `setEditorComponent()`-based UX tweaks in one place so they remain compatible with each other.

## Attribution

This repo maintains its own rewritten and independently evolving variant of the upstream `editor-enhancements` extension, under the local name `pieditor`.
The original extension concept and initial implementation came from `w-winter/dot314`:
- https://github.com/w-winter/dot314/tree/main/extensions/editor-enhancements

Please keep that upstream credit in place when updating this local version. This repo may continue evolving the extension in its own direction, but the original author should remain credited for the upstream design and starting point.

File picker preview highlighting is also powered by:
- `bat`: https://github.com/sharkdp/bat
- `syntect`: https://github.com/trishume/syntect/

This extension currently provides:
- powerline-style status bar rendered in the editor's top border
- `@`-triggered file picking for inserting `@path` refs at the cursor
- shell completions in `!` / `!!` mode
- `alt+v` raw clipboard paste that bypasses Pi's large-paste markers
- double-paste expansion for terminal bracketed pastes that Pi collapses into large-paste markers
- double-submit on an exactly empty editor to send `continue`, with busy sessions using follow-up delivery
- `alt+c` / `/copy-editor` raw active prompt editor buffer copy
- optional remapping of the editor's empty-editor double-escape gesture to an extension command such as `/anycopy`
- configurable command remapping (e.g. make `/tree` execute `/anycopy` instead)
- dedicated `caveman` status-bar segment that displays the standalone caveman extension's generic `caveman` status when active

## Usage

This extension requires Pi `^0.84.0` and integrates directly into Pi's editor. Choose Pi's official fullscreen mode through `/settings` or launch with `--tui-mode fullscreen`; pieditor works with both Pi-owned regular and fullscreen rendering and never forces or migrates that setting. Pi continues to own viewport composition and mode selection.

On each non-empty submit from a detached fullscreen transcript, pieditor scrolls to the bottom immediately before forwarding the remapped text. Already-following fullscreen transcripts and regular mode are unaffected.

Notable interactions:
- Type `@` at token start to open the file picker
- In the file picker, `space` queues or unqueues the highlighted file, or enters the highlighted directory
- In the file picker, `ctrl+n` / `ctrl+p` move the highlight down / up in the file list and options panel
- In the file picker, `enter` inserts the highlighted item plus any queued selections, while `esc` at the root inserts only queued selections
- The picker opens as a near-full-height overlay, keeps the Files panel at a fixed height, and renders an internal preview pane below it that fills the remaining height for the highlighted file or directory
- File previews in the preview pane can use either the picker-local syntect native addon (`previewHighlightMode: "native"`) or Pi's built-in syntax highlighting (`previewHighlightMode: "builtin"`)
- The file picker's search includes files inside symlinked directories only when their real path stays under the picker root, including when `respectGitignore` is enabled for a git repo
- The file picker's search box uses Pi's shared `Input` editing behavior for word/home/end cursor movement and related text editing shortcuts
- Paste the same large terminal bracketed paste twice within 1000 ms to replace the collapsed draft with its expanded text. The first paste follows Pi's native marker behavior; the second works only while draft text is unchanged. Cursor-only movement, including leaving the cursor at the draft end, is allowed. Expansion replaces all currently valid Pi paste markers in the draft, not only the repeated one; this all-marker behavior avoids leaving hidden content but can expand unrelated earlier markers. Successful expansion through Pi's supported `setText()` moves the cursor to the end of the whole draft, even when the repeated marker was in the middle. One Undo immediately afterward restores the previously collapsed marker draft. `alt+v` remains a separate raw clipboard path and does not participate.
- Press `alt+v` to paste clipboard text raw into the editor
- Press `alt+c` or run `/copy-editor` to copy the active prompt editor buffer as raw text; it copies only current editor text, not transcript output, selection text, footer/status text, or overlay/replacement UI contents. If the editor is empty it reports `Editor buffer empty` and does not modify the clipboard.
- Press the configured submit key twice within 500 ms on an exactly empty editor to send `continue`; the warning-colored frame marks the armed interval, autocomplete retains native submit handling, and any non-submit input cancels the gesture.
- If the standalone `extensions/caveman` extension is loaded, built-in presets show the active `🪨 caveman` indicator through the dedicated `caveman` segment; custom segment lists must include `caveman` or `extension_statuses` to show it.
- If the standalone `extensions/fast` extension is loaded, status key `fast` is appended to the `model` segment as compact `⚡` or `⚡*` without a dot separator. `extension_statuses` suppresses `fast` when `model` is configured.
- Optionally configure `doubleEscapeCommand` in `~/.pi/agent/pieditor.json` or `.pi/pieditor.json` to invoke an extension command on double-escape when the editor is empty and Pi is idle
- Optionally configure `commandRemap` in `~/.pi/agent/pieditor.json` or `.pi/pieditor.json` to redirect slash commands at submit time (e.g. typing `/tree` executes `/anycopy` instead)

## Configuration

This extension primarily reads two config files:

1. `~/.pi/agent/pieditor.json` for global defaults
2. `.pi/pieditor.json` for project overrides

Put file picker settings under the nested `filePicker` key in either file (copy from `config.json.example`).

Editor schema help: this extension now ships `extensions/pieditor/configuration_schema.json`. I found no pi-side auto-discovery for that filename in this repo or the installed pi package, so use it as editor tooling only: either associate your config file with that schema in editor settings, or add a `$schema` path manually when your config location makes a stable relative path possible.

For example, in this repo a project-local `.pi/pieditor.json` can point at:

```json
{
  "$schema": "../extensions/pieditor/configuration_schema.json"
}
```

Then add the rest of your config fields:

- `doubleEscapeCommand`: optional extension command name to invoke on double-escape
  - default: `null`
  - accepts either `"anycopy"` or `"/anycopy"`
  - only commands registered via `pi.registerCommand()` are supported
  - Pi native built-ins like `/tree` are not supported here
- `commandRemap`: map of command names to replacements, applied at submit time
  - default: `{}`
  - keys and values are normalized (leading `/` stripped, whitespace trimmed)
  - works for all command types: built-in (`/tree`, `/model`), extension, skill, and template commands
  - arguments and subcommand syntax (everything after the command name) are preserved
- `doublePaste`: nested terminal bracketed-paste config
  - `enabled`: default `true`; set `false` to retain ordinary Pi native paste behavior with no double-paste interception
  - `windowMs`: default `1000`; positive integer window in milliseconds between the native collapsed paste and its matching repeat
  - only a complete bracketed paste that Pi actually turns into a valid `[paste #…]` marker can arm the feature; short pastes and typed marker-like text do not
  - editing draft text permanently cancels eligibility, even if Undo restores the draft; cursor-only movement does not
  - successful expansion uses Pi's supported full expansion and expands all valid markers in the draft; if expanded content still looks like a paste marker, the repeat falls back to native paste to avoid re-expansion on submit
- The old `fixedEditor` config is obsolete and ignored. Remove it and choose Pi's official fullscreen mode through `/settings` or `--tui-mode fullscreen` instead.
- `filePicker`: nested file picker config
  - `respectGitignore`: default `true`
  - `skipHidden`: default `true`
  - `allowFolderSelection`: default `true`; when enabled, folders can be queued/attached as `@path/` refs while `→` still opens them for navigation; when disabled, folders stay visible for navigation and render with a nav marker instead of a checkbox
  - `skipPatterns`: default `["node_modules"]`
  - `tabCompletionMode`: `"segment"` or `"bestMatch"` (default `"bestMatch"`)
    - `"segment"`: prefix-only candidate matching, then complete one word-part at a time
    - `"bestMatch"`: use the strongest scoped fuzzy match and replace the whole query in one Tab
  - `previewHighlightMode`: `"native"` or `"builtin"` (default `"builtin"`)
    - `"builtin"`: always use Pi's built-in JS highlighter and skip native warmup/load work
    - `"native"`: use the optional picker-local Rust/syntect highlighter backed by bat's embedded compiled assets, with Pi built-in highlighting as runtime fallback if the native binary is unavailable
- `editorChrome`: nested editor chrome config
  - `style`: `classic` or `amp` (default `classic`); `classic` preserves the existing editor chrome. `amp` uses rounded Amp-style editor borders, keeps status-bar `leftSegments` and `rightSegments` split across the top border with border-line fill between them, moves configured `path`/`git` status segments to the right-aligned bottom border, keeps an empty Amp frame when `statusBar.enabled` is `false`, and falls back to classic editor lines in very narrow terminals. It does not add Amp non-editor UI, color config, or other Amp features.
- `statusBar`: nested status-bar config
  - `enabled`: default `true`
  - `preset`: one of `default`, `minimal`, `compact`, `full`, `nerd`, `ascii`; default `default`
  - `leftSegments`: optional ordered list of segment ids for the left side; when omitted, inherits the preset default
  - `rightSegments`: optional ordered list of segment ids for the right side; when omitted, inherits the preset default
  - `separator`: optional literal separator text inserted between visible segments; when omitted, inherits the preset separator; may be empty (`""`)
  - overflow handling: status lines render normally first, then fall back to compact segment output when the terminal is too narrow. Compact fallback always separates same-side segments with ` | `, regardless of configured separator. Examples: model `✦ claude` becomes `claude`, context `12.5%/200k` becomes `12.5%`, and git `⎇ main *1` becomes `main *1`.
  - `colors`: optional semantic color overrides layered on top of the preset palette
    - supported color keys: `pi`, `model`, `path`, `gitDirty`, `gitClean`, `thinking`, `context`, `contextWarn`, `contextError`, `cost`, `tokens`, `separator`
    - values may be Pi theme color names or `#RRGGBB` hex
  - `segmentOptions`: optional per-segment overrides layered on top of the preset defaults
    - `model.showThinkingLevel`: boolean
    - `path.mode`: `basename`, `abbreviated`, or `full`
    - `path.maxLength`: positive integer, used with `abbreviated`
    - `git.showBranch`, `git.showStaged`, `git.showUnstaged`, `git.showUntracked`: booleans
    - `time.format`: `12h` or `24h`
    - `time.showSeconds`: boolean
  - icon mode: Nerd Font icons are on by default; set `POWERLINE_NERD_FONTS=0` before launching Pi to force ASCII fallbacks. The examples below use ASCII fallback icons.
  - supported segment ids:

    | id | visual example | description |
    | --- | --- | --- |
    | `pi` | `π` | Pi mark. Hidden when the active icon set has no Pi icon. |
    | `model` | `✦ sonnet ⚡ · [med]` | Active model name. May append thinking level when `model.showThinkingLevel` is enabled. If the standalone `extensions/fast` extension is loaded, also appends Fast Mode's `fast` status as compact `⚡` or `⚡*`; `extension_statuses` suppresses `fast` when `model` is configured. |
    | `path` | `▣ pieditor` | Current working directory. Controlled by `path.mode` and `path.maxLength`. |
    | `git` | `⎇ main *2 +1 ?3` | Current git branch and optional dirty counters for unstaged, staged, and untracked files. |
    | `token_in` | `↙ 1.2k` | Input token count. Hidden when zero. |
    | `token_out` | `↗ 830` | Output token count. Hidden when zero. |
    | `token_total` | `◎ 2.0k` | Total token count across input, output, cache read, and cache write. Hidden when zero. |
    | `cost` | `$0.03` or `(sub)` | Session cost, or subscription marker when the model uses OAuth. Hidden when neither applies. |
    | `context_pct` | `◫ 42.0%/200k` | Context usage percent plus context window size. Warn/error colors apply above 70%/90%. Hidden when context size is unknown. |
    | `context_total` | `◫ 200k` | Context window size. Hidden when unknown. |
    | `time_spent` | `◷ 3m12s` | Elapsed session time. Hidden during the first second. |
    | `time` | `◷ 14:05` or `◷ 2:05pm` | Current wall-clock time. Controlled by `time.format` and `time.showSeconds`. |
    | `session` | `◇ abc12345` | Current session id prefix, or `new` before a session id exists. |
    | `hostname` | `@ macbook` | Hostname before the first dot. |
    | `cache_read` | `⟳ ↙ 4.1k` | Cache read token count. Hidden when zero. |
    | `cache_write` | `⟳ ↗ 900` | Cache write token count. Hidden when zero. |
    | `thinking` | `think:med` | Current thinking level as `off`, `min`, `low`, `med`, `high`, or `xhigh`. |
    | `caveman` | `🪨 caveman` | Standalone `extensions/caveman` integration. Renders generic extension status key `caveman`; hidden unless that extension sets the status. `extension_statuses` suppresses `caveman` when this dedicated segment is configured. |
    | `extension_statuses` | `🧪 tests · sync` | Generic fallback bucket for extension statuses set via `ctx.ui.setStatus(key, text)`. Shows statuses that do not have a configured dedicated segment; hides empty values and values starting with `[`. |

```json
{
  "doubleEscapeCommand": "anycopy",
  "commandRemap": {
    "tree": "anycopy",
    "resume": "switch-session"
  },
  "doublePaste": {
    "enabled": true,
    "windowMs": 1000
  },
  "editorChrome": {
    "style": "classic"
  },
  "filePicker": {
    "respectGitignore": true,
    "skipHidden": true,
    "allowFolderSelection": true,
    "skipPatterns": ["node_modules"],
    "tabCompletionMode": "bestMatch",
    "previewHighlightMode": "builtin"
  },
  "statusBar": {
    "enabled": true,
    "preset": "default",
    "leftSegments": ["pi", "model", "caveman", "path", "git"],
    "rightSegments": ["context_pct", "extension_statuses"],
    "separator": " | ",
    "colors": {
      "model": "success",
      "separator": "muted",
      "context": "#89d281"
    },
    "segmentOptions": {
      "model": {
        "showThinkingLevel": true
      },
      "path": {
        "mode": "abbreviated",
        "maxLength": 32
      },
      "git": {
        "showUntracked": false
      }
    }
  }
}
```

Status bar presets are borrowed from `pi-powerline-footer`, but this extension ports only the bar itself — no stash UI, welcome overlay, or working vibes.

Set `doubleEscapeCommand` to `null` to disable the remapping and keep Pi's native double-escape behavior. Set `commandRemap` to `{}` (or omit it) to disable command remapping.

Runtime merge order for pieditor config is:
1. built-in defaults
2. global `~/.pi/agent/pieditor.json`
3. project `.pi/pieditor.json`

`commandRemap` maps are merged by key. `doublePaste`, `editorChrome`, `filePicker`, and `statusBar` values are merged by field, with later layers winning; invalid `editorChrome.style` values are ignored so lower layers/defaults still apply. `filePicker.skipPatterns` comes from the last layer that sets it. `statusBar.leftSegments` and `statusBar.rightSegments` are each replaced by the last layer that sets them, `separator` takes the last configured literal string, `colors` merge by semantic key, and `segmentOptions` merge per nested field.

Config layout:

```text
project-root/
├── .pi/
│   └── pieditor.json
└── …

~/.pi/agent/
└── pieditor.json
```

The former `@yzlin/pieditor/replacement-surface-lease` export has been removed. This is a breaking API change; consumers must remove that integration and rely on Pi-owned rendering.

## Native preview addon

The file picker can use a local Rust/N-API addon at `extensions/pieditor/native/syntect-picker-preview/` for richer preview highlighting.

Build the v1 prebuild from the repo root on macOS arm64:

```bash
npm run build:syntect-picker-preview
```

Current scope:
- picker preview only
- v1 native prebuild support is macOS arm64 only (`syntect-picker-preview.darwin-arm64.node`)
- the addon has no install-time build step; unsupported platforms install normally and use fallback highlighting
- optional at runtime when `previewHighlightMode` is `"native"`; if the native binary is absent, unsupported, or fails to load, preview highlighting falls back to Pi's current JS highlighter
- preview highlighting is powered by `bat` (https://github.com/sharkdp/bat) and `syntect` (https://github.com/trishume/syntect/)
- syntax + theme resolution comes from bat's embedded compiled assets, not direct loading of the vendored `.tmTheme` files
- native preview colors use bat's built-in `Monokai Extended` for dark mode and `Monokai Extended Light` for light mode
- preview gutter line numbers and the adjacent divider follow bat's gutter foreground/divider colors even when syntax highlighting falls back or the file type is unrecognized
- output matches bat's built-in compiled assets for those theme names; user-local bat config/theme overrides are not applied here

## Maintainer docs

- [`docs/architecture.md`](./docs/architecture.md)

## Notes

- The configured double-escape command is only triggered when the editor is empty and Pi is idle
- If the configured command is not a registered extension command, the extension warns and falls back to native behavior
- Command remapping intercepts at the editor submission layer via `onSubmit`, so it applies uniformly to all submit paths (Enter, double-escape gesture, etc.) and works with any command type — built-in, extension, skill, or template. If a remap target doesn't exist as a registered command, pi treats it as a regular prompt
- Because this extension owns `setEditorComponent()`, disable standalone editor-replacement extensions such as `shell-completions/`, `file-picker.ts`, and `raw-paste.ts` to avoid conflicts
- `alt+c` and `/copy-editor` share the same copy path and only run when the active prompt editor is ready; overlays report `Editor not ready`.

## Manual validation notes

- With Pi `^0.84.0`, verify pieditor in both regular and official fullscreen modes, including switching through `/settings`; confirm pieditor does not change the selected mode
- Type text in the prompt editor, press `alt+c`, then run `/copy-editor`; confirm both copy the same raw editor buffer, empty buffers report `Editor buffer empty`, and active overlays report `Editor not ready`
