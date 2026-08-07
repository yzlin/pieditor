import {
  CustomEditor,
  type ExtensionContext,
  type ExtensionUIContext,
  type KeybindingsManager,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteProvider,
  EditorTheme,
  TUI,
} from "@earendil-works/pi-tui";
import { getText } from "@mariozechner/clipboard";

import type {
  DoublePasteRuntimeConfig,
  EditorChromeRuntimeConfig,
  StatusBarRuntimeConfig,
} from "../config/index.js";
import { openFilePicker } from "../file-picker/index.js";
import { findCompletionShell, type ShellInfo } from "../shell/index.js";
import {
  buildAmpStatusLayout,
  renderStatusBarLine,
} from "../status-bar/index.js";
import {
  AMP_BODY_HORIZONTAL_CHROME_WIDTH,
  MIN_AMP_WIDTH,
  renderAmpEditorChrome,
} from "./amp-chrome.js";
import { wrapProviderWithShellAndAtFiltering } from "./autocomplete.js";
import { remapCommand } from "./command-remap.js";
import {
  DoubleSubmitContinue,
  matchesConfiguredSubmit,
} from "./double-enter-continue.js";
import {
  consumeDoubleEscape,
  matchesInterrupt,
  shouldHandleConfiguredDoubleEscape,
} from "./double-escape.js";
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  confirmNativePaste,
  type DoublePasteState,
  inspectDoublePaste,
} from "./double-paste.js";

interface EditorRenderCache {
  width: number;
  terminalRows: number;
  text: string;
  cursorLine: number;
  cursorCol: number;
  lines: string[];
}

interface EnhancedEditorOptions {
  onContinue: () => void;
  getDoubleEscapeCommand: () => string | null;
  canTriggerDoubleEscapeCommand: () => boolean;
  commandRemap: Record<string, string>;
  doublePaste: DoublePasteRuntimeConfig;
  editorChrome: EditorChromeRuntimeConfig;
  statusBar: {
    config: StatusBarRuntimeConfig;
    getContext: () => ExtensionContext | null;
    getFooterData: () => ReadonlyFooterDataProvider | null;
  };
}

const VALID_PASTE_MARKER = /^\[paste #\d+(?: \+\d+ lines| \d+ chars)?\]$/;
const PASTE_MARKER_TOKEN = /\[paste #\d+(?: \+\d+ lines| \d+ chars)?\]/;
const ANSI_SGR_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "g"
);

function insertedText(before: string, after: string): string | null {
  let prefixLength = 0;
  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength &&
    suffixLength < after.length - prefixLength &&
    before[before.length - 1 - suffixLength] ===
      after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  if (before.length !== prefixLength + suffixLength) {
    return null;
  }
  return after.slice(prefixLength, after.length - suffixLength);
}

function insertedTextAtOffset(
  before: string,
  after: string,
  insertionOffset: number
): string | null {
  const insertionLength = after.length - before.length;
  if (
    insertionLength < 0 ||
    insertionOffset < 0 ||
    insertionOffset > before.length ||
    after.slice(0, insertionOffset) !== before.slice(0, insertionOffset) ||
    after.slice(insertionOffset + insertionLength) !==
      before.slice(insertionOffset)
  ) {
    return null;
  }
  return after.slice(insertionOffset, insertionOffset + insertionLength);
}

function cursorOffset(
  text: string,
  cursor: { line: number; col: number }
): number | null {
  const lines = text.split("\n");
  const line = lines[cursor.line];
  if (line === undefined || cursor.col < 0 || cursor.col > line.length) {
    return null;
  }
  const precedingLength = lines
    .slice(0, cursor.line)
    .reduce((sum, value) => sum + value.length + 1, 0);
  return precedingLength + cursor.col;
}

function didCreateNativePasteMarker(options: {
  beforeText: string;
  beforeExpandedText: string;
  afterText: string;
  afterExpandedText: string;
  insertionOffset: number;
}): boolean {
  const marker = insertedTextAtOffset(
    options.beforeText,
    options.afterText,
    options.insertionOffset
  );
  const expandedInsertion = insertedText(
    options.beforeExpandedText,
    options.afterExpandedText
  );
  return Boolean(
    marker &&
      VALID_PASTE_MARKER.test(marker) &&
      expandedInsertion !== null &&
      expandedInsertion !== marker
  );
}

const EMPTY_DOUBLE_PASTE_STATE: DoublePasteState = {
  candidate: null,
  pending: null,
};

export class EnhancedEditor extends CustomEditor {
  private readonly tuiInstance: TUI;
  private readonly sessionStartTime = Date.now();
  private openingPicker = false;
  private doublePasteState = EMPTY_DOUBLE_PASTE_STATE;
  private bracketedPasteBuffer: string | null = null;
  private warnedDoublePasteFailure = false;
  private readonly wrappedAutocompleteProviders = new WeakSet<AutocompleteProvider>();
  private lastEscapeTime = 0;
  private submitHandler?: (text: string) => void;
  private readonly doubleSubmitContinue: DoubleSubmitContinue;

  private readonly shell: ShellInfo;
  private readonly ui: ExtensionUIContext;
  private readonly editorTheme: EditorTheme;
  private readonly options: EnhancedEditorOptions;
  private readonly keybindingsManager: KeybindingsManager;
  private editorRenderCache: EditorRenderCache | null = null;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    ui: ExtensionUIContext,
    options: EnhancedEditorOptions,
    keybindingsManager: KeybindingsManager = keybindings
  ) {
    super(tui, theme, keybindings);
    this.tuiInstance = tui;
    this.ui = ui;
    this.editorTheme = theme;
    this.options = options;
    this.keybindingsManager = keybindingsManager;
    this.shell = findCompletionShell();
    this.doubleSubmitContinue = new DoubleSubmitContinue({
      onArmedChange: () => {
        this.editorRenderCache = null;
        this.tuiInstance.requestRender();
      },
    });

    this.installOnSubmitInterceptor();

    this.ui.notify(`pieditor loaded (shell: ${this.shell.type})`, "info");
  }

  setText(text: string): void {
    super.setText(text);
    if (text !== "") {
      this.doubleSubmitContinue.nonSubmitInput();
    }
  }

  private installOnSubmitInterceptor(): void {
    Object.defineProperty(this, "onSubmit", {
      get: (): ((text: string) => void) | undefined => this.submitHandler,
      set: (fn: ((text: string) => void) | undefined) => {
        this.submitHandler = fn
          ? (text: string) => {
              const remappedText = remapCommand(
                text,
                this.options.commandRemap
              );
              const tui = this.tuiInstance;
              if (
                text !== "" &&
                tui.mode === "fullscreen" &&
                "isFollowingOutput" in tui &&
                tui.isFollowingOutput === false &&
                "scrollToBottom" in tui &&
                typeof tui.scrollToBottom === "function"
              ) {
                tui.scrollToBottom();
              }
              fn(remappedText);
            }
          : undefined;
      },
      configurable: true,
      enumerable: true,
    });
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    if (!provider || this.wrappedAutocompleteProviders.has(provider)) {
      super.setAutocompleteProvider(provider);
      return;
    }

    const wrapped = wrapProviderWithShellAndAtFiltering(provider, this.shell);
    this.wrappedAutocompleteProviders.add(wrapped);
    super.setAutocompleteProvider(wrapped);
  }

  async openFilePickerAtCursor(): Promise<void> {
    const refs = await openFilePicker(this.ui);
    if (!refs) {
      return;
    }
    const beforeText = this.getText();
    this.insertTextAtCursor(`${refs} `);
    this.cancelDoublePasteAfterDraftChange(beforeText);
    this.tuiInstance.requestRender();
  }

  async pasteClipboardRawAtCursor(): Promise<void> {
    let text: string | undefined;
    try {
      text = await getText();
    } catch {
      text = undefined;
    }

    if (!text) {
      return;
    }

    // Normalize line endings
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Insert using editor primitive (NOT bracketed paste), so it won't turn into [paste #..]
    const beforeText = this.getText();
    this.insertTextAtCursor(normalized);
    this.cancelDoublePasteAfterDraftChange(beforeText);
    this.tuiInstance.requestRender();
  }

  handleInput(data: string): void {
    if (this.openingPicker) {
      return;
    }

    if (!matchesInterrupt(this.keybindingsManager, data)) {
      this.lastEscapeTime = 0;
    }

    const isQualifyingSubmit =
      matchesConfiguredSubmit(this.keybindingsManager, data) &&
      !this.isShowingAutocomplete() &&
      this.getText() === "";
    if (isQualifyingSubmit) {
      const action = this.doubleSubmitContinue.qualifyingSubmit();
      if (action === "continue") {
        this.options.onContinue();
      }
      return;
    }
    this.doubleSubmitContinue.nonSubmitInput();

    if (
      this.options.doublePaste.enabled &&
      this.handleBracketedPasteInput(data)
    ) {
      return;
    }

    const doubleEscapeCommand = this.options.getDoubleEscapeCommand();
    if (
      shouldHandleConfiguredDoubleEscape({
        doubleEscapeCommand,
        data,
        keybindingsManager: this.keybindingsManager,
        isShowingAutocomplete: this.isShowingAutocomplete(),
        editorText: this.getText(),
        canTriggerDoubleEscapeCommand:
          this.options.canTriggerDoubleEscapeCommand(),
      })
    ) {
      this.handleConfiguredDoubleEscape(doubleEscapeCommand);
      return;
    }

    // Intercept @ at token start to open picker
    if (data === "@" && this.shouldTriggerFilePicker()) {
      this.openingPicker = true;
      if (this.isShowingAutocomplete()) {
        // Escape cancels autocomplete in the base editor
        super.handleInput("\x1b");
      }
      this.openFilePickerAtCursor().finally(() => {
        this.openingPicker = false;
      });
      return;
    }

    this.handleNativeInput(data);
  }

  private handleNativeInput(data: string): void {
    const beforeText = this.getText();
    super.handleInput(data);
    this.cancelDoublePasteAfterDraftChange(beforeText);
  }

  private cancelDoublePasteAfterDraftChange(beforeText: string): void {
    if (this.doublePasteState.candidate && this.getText() !== beforeText) {
      this.doublePasteState = EMPTY_DOUBLE_PASTE_STATE;
    }
  }

  private handleBracketedPasteInput(data: string): boolean {
    if (
      this.bracketedPasteBuffer === null &&
      !data.startsWith(BRACKETED_PASTE_START)
    ) {
      return false;
    }

    const buffered = (this.bracketedPasteBuffer ?? "") + data;
    const endIndex = buffered.indexOf(
      BRACKETED_PASTE_END,
      BRACKETED_PASTE_START.length
    );
    if (endIndex === -1) {
      this.bracketedPasteBuffer = buffered;
      return true;
    }

    this.bracketedPasteBuffer = null;
    const envelopeEnd = endIndex + BRACKETED_PASTE_END.length;
    const envelope = buffered.slice(0, envelopeEnd);
    const remaining = buffered.slice(envelopeEnd);
    if (!this.handleDoublePaste(envelope)) {
      this.handleNativeInput(envelope);
    }
    if (remaining) {
      this.handleInput(remaining);
    }
    return true;
  }

  private handleDoublePaste(data: string): boolean {
    const draftText = this.getText();
    const now = Date.now();
    const inspection = inspectDoublePaste(this.doublePasteState, {
      input: data,
      draftText,
      now,
      windowMs: this.options.doublePaste.windowMs,
    });
    if (inspection.intent === "not-paste") {
      return false;
    }

    this.lastEscapeTime = 0;

    if (inspection.intent === "allow-native") {
      this.allowAndConfirmNativePaste(data, inspection.state);
      return true;
    }

    this.doublePasteState = inspection.state;
    try {
      const expandedText = this.getExpandedText();
      if (PASTE_MARKER_TOKEN.test(expandedText)) {
        this.retryNativePaste(data, now);
        return true;
      }
      this.setText(expandedText);
    } catch {
      this.retryNativePaste(data, now);
      return true;
    }

    try {
      this.tuiInstance.requestRender();
    } catch {
      // Text is already expanded, so native fallback would duplicate the paste.
      this.warnDoublePasteFailure();
    }
    return true;
  }

  private retryNativePaste(data: string, now: number): void {
    this.warnDoublePasteFailure();
    const retry = inspectDoublePaste(EMPTY_DOUBLE_PASTE_STATE, {
      input: data,
      draftText: this.getText(),
      now,
      windowMs: this.options.doublePaste.windowMs,
    });
    this.allowAndConfirmNativePaste(data, retry.state);
  }

  private allowAndConfirmNativePaste(
    data: string,
    pendingState: DoublePasteState
  ): void {
    let beforeExpandedText: string;
    try {
      beforeExpandedText = this.getExpandedText();
    } catch {
      this.doublePasteState = EMPTY_DOUBLE_PASTE_STATE;
      super.handleInput(data);
      this.warnDoublePasteFailure();
      return;
    }
    const beforeText = this.getText();
    const insertionOffset = cursorOffset(beforeText, this.getCursor());

    super.handleInput(data);

    const afterText = this.getText();
    let nativeCreatedValidMarker = false;
    try {
      nativeCreatedValidMarker =
        insertionOffset !== null &&
        didCreateNativePasteMarker({
          beforeText,
          beforeExpandedText,
          afterText,
          afterExpandedText: this.getExpandedText(),
          insertionOffset,
        });
    } catch {
      this.warnDoublePasteFailure();
    }
    this.doublePasteState = confirmNativePaste(pendingState, {
      nativeCreatedValidMarker,
      draftText: afterText,
    });
  }

  private warnDoublePasteFailure(): void {
    if (this.warnedDoublePasteFailure) {
      return;
    }
    this.warnedDoublePasteFailure = true;
    try {
      this.ui.notify("Double-paste handling failed", "warning");
    } catch {
      // Warning delivery must not prevent native paste fallback.
    }
  }

  private handleConfiguredDoubleEscape(command: string | null): void {
    const result = consumeDoubleEscape({
      lastEscapeTime: this.lastEscapeTime,
    });
    this.lastEscapeTime = result.nextLastEscapeTime;

    if (!result.shouldSubmit) {
      return;
    }

    if (!(command && this.onSubmit)) {
      return;
    }

    this.onSubmit(`/${command}`);
  }

  private shouldTriggerFilePicker(): boolean {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";

    if (cursor.col === 0) {
      return true;
    }

    const before = line[cursor.col - 1];
    return before === " " || before === "\t" || before === undefined;
  }

  dispose(): void {
    this.doubleSubmitContinue.dispose();
  }

  private renderWithChrome(width: number): {
    statusLines?: string[];
    editorLines: string[];
  } {
    if (this.options.editorChrome.style === "amp" && width >= MIN_AMP_WIDTH) {
      const baseEditorLines = this.renderEditorLines(
        width - AMP_BODY_HORIZONTAL_CHROME_WIDTH
      );
      return {
        editorLines: renderAmpEditorChrome({
          width,
          editorLines: baseEditorLines,
          labels: this.buildAmpLabels(width),
          borderColor: this.doubleSubmitContinue.isArmed()
            ? (value) => this.ui.theme.fg("warning", value)
            : (value) => this.editorTheme.borderColor(value),
        }),
      };
    }

    const baseEditorLines = this.renderEditorLines(width);
    const editorLines = this.doubleSubmitContinue.isArmed()
      ? baseEditorLines.map((line) => {
          const plain = line.replace(ANSI_SGR_PATTERN, "");
          return plain.startsWith("─")
            ? this.ui.theme.fg("warning", plain)
            : line;
        })
      : baseEditorLines;
    const statusLine = this.renderStatusLine(width, baseEditorLines);
    return {
      statusLines: statusLine === null ? undefined : [statusLine],
      editorLines,
    };
  }

  render(width: number): string[] {
    const parts = this.renderWithChrome(width);
    return [...(parts.statusLines ?? []), ...parts.editorLines];
  }

  private renderEditorLines(width: number): string[] {
    const cursor = this.getCursor();
    const text = this.getText();
    const terminalRows = this.getTerminalRows();
    const cache = this.editorRenderCache;
    if (
      cache &&
      cache.width === width &&
      cache.terminalRows === terminalRows &&
      cache.text === text &&
      cache.cursorLine === cursor.line &&
      cache.cursorCol === cursor.col &&
      !this.isShowingAutocomplete()
    ) {
      return cache.lines;
    }

    const lines = super.render(width);
    this.editorRenderCache = this.isShowingAutocomplete()
      ? null
      : {
          width,
          terminalRows,
          text,
          cursorLine: cursor.line,
          cursorCol: cursor.col,
          lines,
        };
    return lines;
  }

  private getTerminalRows(): number {
    const terminal = Reflect.get(this.tuiInstance, "terminal");
    const rows = terminal ? Reflect.get(terminal, "rows") : undefined;
    return typeof rows === "number" && Number.isFinite(rows) ? rows : 0;
  }

  private buildAmpLabels(width: number) {
    return buildAmpStatusLayout({
      ctx: this.options.statusBar.getContext(),
      footerData: this.options.statusBar.getFooterData(),
      config: this.options.statusBar.config,
      sessionStartTime: this.sessionStartTime,
      theme: this.ui.theme,
      width,
    });
  }

  private renderStatusLine(
    width: number,
    editorLines: string[]
  ): string | null {
    if (
      !this.options.statusBar.config.enabled ||
      width < 10 ||
      editorLines.length === 0
    ) {
      return null;
    }

    const ctx = this.options.statusBar.getContext();
    if (!ctx) {
      return null;
    }

    return renderStatusBarLine({
      width,
      ctx,
      footerData: this.options.statusBar.getFooterData(),
      config: this.options.statusBar.config,
      sessionStartTime: this.sessionStartTime,
      theme: this.ui.theme,
    });
  }
}
