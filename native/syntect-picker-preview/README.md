# syntect-picker-preview

Local picker-only native addon for `extensions/pieditor`.

## Scope

- File picker preview highlighting only
- v1 native prebuild support is macOS arm64 only (`syntect-picker-preview.darwin-arm64.node`)
- No install-time build step: unsupported platforms install normally and use fallback highlighting
- Optional at runtime: if no supported `.node` binary is present or loading fails, the picker falls back to Pi's current JS highlighting path

## Build

From repo root:

```bash
npm run build:syntect-picker-preview
```

Or from this package directory:

```bash
node ./scripts/build.mjs
```

## Notes

- The macOS arm64 prebuild (`syntect-picker-preview.darwin-arm64.node`) is tracked for npm releases; other generated `.node` binaries are local build artifacts and ignored by git.
- Native file picker preview highlighting is powered by `bat` (https://github.com/sharkdp/bat) and `syntect` (https://github.com/trishume/syntect/).
- Native preview syntax + theme resolution uses bat's embedded compiled assets via `bat::assets::HighlightingAssets::from_binary()`, instead of loading the vendored `.tmTheme` files directly.
- Native preview colors use bat's built-in `Monokai Extended` for dark mode and `Monokai Extended Light` for light mode.
- When native preview highlighting is active, picker preview gutter line numbers and the adjacent divider follow bat's gutter foreground/divider colors.
- Output matches bat's built-in compiled assets for those theme names; user-local bat config/theme overrides are not applied here.
- Native ANSI output is foreground-only, so the picker keeps its own pane background instead of painting bat-style token backgrounds behind text.
- Windows, Linux, and non-arm64 macOS native prebuilds are not wired in this first pass.
