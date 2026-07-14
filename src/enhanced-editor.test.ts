import { describe, expect, it } from "bun:test";

import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import { renderAmpEditorChrome } from "./editor/amp-chrome";
import { matchesInterrupt } from "./editor/double-escape";
import { EnhancedEditor } from "./enhanced-editor";

const ESC = String.fromCharCode(27);
const TOP_SCROLL_COLOR_PATTERN = new RegExp(
  `${ESC}\\[2m─── ↑ 2 more\\s+${ESC}\\[0m`,
  "u"
);
const BOTTOM_SCROLL_COLOR_PATTERN = new RegExp(
  `${ESC}\\[2m─── ↓ 3 more\\s+${ESC}\\[0m`,
  "u"
);

type EditorInternals = {
  submitValue(): void;
  autocompleteProvider: AutocompleteProvider;
};

function editorInternals(editor: EnhancedEditor): EditorInternals {
  return editor as unknown as EditorInternals;
}

function createEditor(
  commandRemap: Record<string, string>,
  options?: {
    statusBarEnabled?: boolean;
    statusBarContext?: ExtensionContext | null;
    statusBarFooterData?: ReadonlyFooterDataProvider | null;
    editorChromeStyle?: "classic" | "amp";
    doubleEscapeCommand?: string | null;
    getDoubleEscapeCommand?: () => string | null;
    canTriggerDoubleEscapeCommand?: () => boolean;
    interruptMatches?: boolean;
    borderColor?: (value: string) => string;
    doublePaste?: { enabled: boolean; windowMs: number };
    notifications?: Array<{ message: string; level: string | undefined }>;
    onNotify?: (message: string, level?: string) => void;
    onRequestRender?: () => void;
  }
) {
  const tui = {
    requestRender() {
      options?.onRequestRender?.();
    },
    terminal: {
      rows: 24,
    },
  } as unknown as ConstructorParameters<typeof EnhancedEditor>[0];

  const theme = {
    borderColor: options?.borderColor ?? ((value: string) => value),
    selectList: {},
  } as unknown as ConstructorParameters<typeof EnhancedEditor>[1];

  const keybindings = {
    matches(_data: string, key: string) {
      if (key === "app.interrupt") {
        return Boolean(options?.interruptMatches);
      }
      return key === "tui.editor.undo" && _data === "\x1f";
    },
  } as unknown as ConstructorParameters<typeof EnhancedEditor>[2];

  const ui = {
    notify(message: string, level?: string) {
      options?.notifications?.push({ message, level });
      options?.onNotify?.(message, level);
    },
    theme: {
      fg(_color: string, text: string) {
        return text;
      },
    },
  } as unknown as ConstructorParameters<typeof EnhancedEditor>[3];

  return new EnhancedEditor(tui, theme, keybindings, ui, {
    getDoubleEscapeCommand:
      options?.getDoubleEscapeCommand ??
      (() => options?.doubleEscapeCommand ?? null),
    canTriggerDoubleEscapeCommand:
      options?.canTriggerDoubleEscapeCommand ?? (() => false),
    commandRemap,
    doublePaste: options?.doublePaste ?? { enabled: true, windowMs: 1000 },
    editorChrome: {
      style: options?.editorChromeStyle ?? "classic",
    },
    statusBar: {
      config: {
        enabled: options?.statusBarEnabled ?? false,
        preset: "default",
      },
      getContext: () => options?.statusBarContext ?? null,
      getFooterData: () => options?.statusBarFooterData ?? null,
    },
  });
}

function createStatusBarContext(): ExtensionContext {
  return {
    model: {
      id: "test-model",
      name: "test-model",
      reasoning: false,
      contextWindow: 200_000,
    },
    modelRegistry: {},
    sessionManager: {
      getBranch() {
        return [];
      },
      getSessionId() {
        return "session-12345678";
      },
    },
    getContextUsage() {
      return {
        tokens: 25_000,
        contextWindow: 200_000,
        percent: 12.5,
      };
    },
  } as unknown as ExtensionContext;
}

function createStatusBarFooterData(
  getExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map()
): ReadonlyFooterDataProvider {
  return {
    getGitBranch() {
      return "main";
    },
    getExtensionStatuses,
    getAvailableProviderCount() {
      return 0;
    },
    onBranchChange() {
      return () => {
        /* noop */
      };
    },
  };
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const pasteInput = (text: string) => `${PASTE_START}${text}${PASTE_END}`;
const longPaste = (label: string) =>
  Array.from({ length: 12 }, (_, index) => `${label}-${index}`).join("\n");

describe("EnhancedEditor double paste", () => {
  it("lets the first large paste collapse natively, then expands without duplication or success notice", () => {
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    let renders = 0;
    const editor = createEditor({}, {
      notifications,
      onRequestRender: () => {
        renders += 1;
      },
    });
    const pasted = longPaste("same");

    editor.handleInput(pasteInput(pasted));
    expect(editor.getText()).toMatch(/^\[paste #1 \+12 lines\]$/);

    editor.handleInput(pasteInput(pasted));

    expect(editor.getText()).toBe(pasted);
    expect(editor.getExpandedText()).toBe(pasted);
    expect(renders).toBe(1);
    expect(notifications).toEqual([
      { message: expect.stringContaining("pieditor loaded"), level: "info" },
    ]);
  });

  it("expands a repeated large paste when both envelopes arrive in chunks", () => {
    const editor = createEditor({});
    const pasted = longPaste("fragmented");

    editor.handleInput(PASTE_START);
    editor.handleInput(pasted);
    editor.handleInput(PASTE_END);
    expect(editor.getText()).toMatch(/^\[paste #1 \+12 lines\]$/);

    editor.handleInput(PASTE_START);
    editor.handleInput(pasted);
    editor.handleInput(PASTE_END);

    expect(editor.getText()).toBe(pasted);
    expect(editor.getExpandedText()).toBe(pasted);
  });

  it("expands a repeated large paste immediately before an existing bracket", () => {
    const editor = createEditor({});
    const pasted = longPaste("before-bracket");
    editor.setText("hello[");
    editor.handleInput("\x1b[D");

    editor.handleInput(pasteInput(pasted));
    expect(editor.getText()).toMatch(/^hello\[paste #1 \+12 lines\]\[$/);

    editor.handleInput(pasteInput(pasted));

    expect(editor.getText()).toBe(`hello${pasted}[`);
    expect(editor.getExpandedText()).toBe(`hello${pasted}[`);
  });

  it("restores the collapsed marker draft with one native undo after expansion", () => {
    const editor = createEditor({});
    const pasted = longPaste("undo");

    editor.handleInput(pasteInput(pasted));
    const collapsedDraft = editor.getText();
    editor.handleInput(pasteInput(pasted));
    expect(editor.getText()).toBe(pasted);

    // Pi TUI's default `tui.editor.undo` binding is ctrl+-, encoded as 0x1f.
    editor.handleInput("\x1f");

    expect(editor.getText()).toBe(collapsedDraft);
  });

  it("expands every valid marker already in the unchanged draft", () => {
    const editor = createEditor({});
    const first = longPaste("first");
    const second = longPaste("second");

    editor.handleInput(pasteInput(first));
    editor.handleInput(pasteInput(second));
    expect(editor.getText()).toContain("[paste #1 +12 lines]");
    expect(editor.getText()).toContain("[paste #2 +12 lines]");

    editor.handleInput(pasteInput(second));

    expect(editor.getText()).toBe(`${first}${second}`);
  });

  it("rolls mismatches so A then B then B expands", () => {
    const editor = createEditor({});
    const first = longPaste("a");
    const second = longPaste("b");

    editor.handleInput(pasteInput(first));
    editor.handleInput(pasteInput(second));
    editor.handleInput(pasteInput(second));

    expect(editor.getText()).toBe(`${first}${second}`);
  });

  it("does not expand after timeout or a draft edit", () => {
    const originalNow = Date.now;
    let now = 100;
    Date.now = () => now;
    try {
      const expiredEditor = createEditor({}, {
        doublePaste: { enabled: true, windowMs: 50 },
      });
      const expired = longPaste("expired");
      expiredEditor.handleInput(pasteInput(expired));
      now = 151;
      expiredEditor.handleInput(pasteInput(expired));
      expect(expiredEditor.getText()).toMatch(
        /^\[paste #1 \+12 lines\]\[paste #2 \+12 lines\]$/
      );

      const editedEditor = createEditor({});
      const edited = longPaste("edited");
      editedEditor.handleInput(pasteInput(edited));
      editedEditor.handleInput("x");
      editedEditor.handleInput(pasteInput(edited));
      expect(editedEditor.getText()).toContain("x[paste #2 +12 lines]");
    } finally {
      Date.now = originalNow;
    }
  });

  it("permanently cancels a candidate after an edit even when undo restores the draft", () => {
    const editor = createEditor({});
    const pasted = longPaste("edit-undo");

    editor.handleInput(pasteInput(pasted));
    editor.handleInput("x");
    editor.handleInput("\x1f");
    editor.handleInput(pasteInput(pasted));

    expect(editor.getText()).toMatch(
      /^\[paste #1 \+12 lines\]\[paste #2 \+12 lines\]$/
    );
  });

  it("keeps a candidate eligible across cursor-only movement", () => {
    const editor = createEditor({});
    const pasted = longPaste("cursor");

    editor.handleInput(pasteInput(pasted));
    editor.handleInput("\x1b[D");
    editor.handleInput(pasteInput(pasted));

    expect(editor.getText()).toBe(pasted);
  });

  it("fails open when expanded content still contains a paste marker token", () => {
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const submitted: string[] = [];
    const pasted = `[paste #1 +12 lines]\n${longPaste("marker-content")}`;
    const editor = createEditor({}, { notifications });
    editor.onSubmit = (text) => {
      submitted.push(text);
    };

    editor.handleInput(pasteInput(pasted));
    editor.handleInput(pasteInput(pasted));
    editorInternals(editor).submitValue();

    expect(submitted).toEqual([`${pasted}${pasted}`]);
    expect(
      notifications.filter(({ level }) => level === "warning")
    ).toHaveLength(1);
  });

  it("does not arm when literal marker text matches an existing native marker", () => {
    const editor = createEditor({});
    const pasted = longPaste("existing");
    const literalMarker = "[paste #1 +12 lines]";

    editor.handleInput(pasteInput(pasted));
    editor.handleInput(pasteInput(literalMarker));
    editor.handleInput(pasteInput(literalMarker));

    expect(editor.getText()).toBe(literalMarker.repeat(3));
  });

  it("does no interception when disabled and never arms for short or marker-like text", () => {
    const disabled = createEditor({}, {
      doublePaste: { enabled: false, windowMs: 1000 },
    });
    const pasted = longPaste("disabled");
    disabled.handleInput(pasteInput(pasted));
    disabled.handleInput(pasteInput(pasted));
    expect(disabled.getText()).toMatch(
      /^\[paste #1 \+12 lines\]\[paste #2 \+12 lines\]$/
    );

    const short = createEditor({});
    short.handleInput(pasteInput("[paste #999 +12 lines]"));
    short.handleInput(pasteInput("[paste #999 +12 lines]"));
    expect(short.getText()).toBe(
      "[paste #999 +12 lines][paste #999 +12 lines]"
    );
  });

  it("resets an armed double escape when a bracketed paste is recognized", () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      const submitted: string[] = [];
      const editor = createEditor({}, {
        doubleEscapeCommand: "anycopy",
        canTriggerDoubleEscapeCommand: () => true,
        interruptMatches: true,
      });
      editor.onSubmit = (text) => {
        submitted.push(text);
      };

      editor.handleInput("\x1b");
      now = 1100;
      editor.handleInput(pasteInput(longPaste("escape-reset")));
      now = 1200;
      editor.handleInput("\x1b");

      expect(submitted).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("fails open when warning notification throws during expansion failure", () => {
    const editor = createEditor({}, {
      onNotify(_message, level) {
        if (level === "warning") {
          throw new Error("notify failed");
        }
      },
    });
    const pasted = longPaste("throwing-notify");
    const originalGetExpandedText = editor.getExpandedText.bind(editor);

    editor.handleInput(pasteInput(pasted));
    editor.getExpandedText = () => {
      throw new Error("expansion failed");
    };
    expect(() => editor.handleInput(pasteInput(pasted))).not.toThrow();
    editor.getExpandedText = originalGetExpandedText;

    expect(editor.getText()).toContain("[paste #2 +12 lines]");
  });

  it("fails open and warns only once when expansion reads fail", () => {
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const editor = createEditor({}, { notifications });
    const first = longPaste("first-failure");
    const second = longPaste("second-failure");
    const originalGetExpandedText = editor.getExpandedText.bind(editor);

    editor.handleInput(pasteInput(first));
    editor.getExpandedText = () => {
      throw new Error("boom");
    };
    editor.handleInput(pasteInput(first));
    editor.getExpandedText = originalGetExpandedText;
    expect(editor.getText()).toContain("[paste #2 +12 lines]");

    editor.handleInput(pasteInput(second));
    editor.getExpandedText = () => {
      throw new Error("again");
    };
    editor.handleInput(pasteInput(second));

    expect(
      notifications.filter(({ level }) => level === "warning")
    ).toHaveLength(1);
  });
});

describe("EnhancedEditor command remap", () => {
  it("remaps slash commands on direct onSubmit invocation", () => {
    const editor = createEditor({ tree: "anycopy" });
    let submitted = "";

    editor.onSubmit = (text) => {
      submitted = text;
    };

    editor.onSubmit?.("/tree");

    expect(submitted).toBe("/anycopy");
  });

  it("remaps slash commands at submit time", () => {
    const editor = createEditor({ tree: "anycopy" });
    const submitted: string[] = [];

    editor.onSubmit = (text) => {
      submitted.push(text);
    };

    editor.setText("/tree");
    editorInternals(editor).submitValue();

    expect(submitted).toEqual(["/anycopy"]);
    expect(editor.getText()).toBe("");
  });

  it("preserves command arguments when remapping", () => {
    const editor = createEditor({ tree: "anycopy" });
    let submitted = "";

    editor.onSubmit = (text) => {
      submitted = text;
    };

    editor.setText("/tree src --depth 2");
    editorInternals(editor).submitValue();

    expect(submitted).toBe("/anycopy src --depth 2");
  });

  it("preserves keybindings manager method binding for interrupt checks", () => {
    const keybindings = {
      keysById: new Map([["app.interrupt", ["escape"]]]),
      matches(_data: string, key: string) {
        return this.keysById.has(key);
      },
    };

    expect(matchesInterrupt(
        keybindings as unknown as Parameters<typeof matchesInterrupt>[0],
        "\x1b"
      )).toBe(true);
  });

  it("forwards autocomplete request options to the wrapped provider", async () => {
    const editor = createEditor({});
    const signal = new AbortController().signal;
    let receivedOptions:
      | {
          signal: AbortSignal;
          force?: boolean;
        }
      | undefined;

    editor.setAutocompleteProvider({
      getSuggestions(
        _lines: string[],
        _cursorLine: number,
        _cursorCol: number,
        options?: { signal: AbortSignal; force?: boolean }
      ) {
        receivedOptions = options;
        return Promise.resolve(null);
      },
      applyCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        _item: AutocompleteItem,
        _prefix: string
      ) {
        return { lines, cursorLine, cursorCol };
      },
    });

    await editorInternals(editor).autocompleteProvider.getSuggestions(
      ["/tree"],
      0,
      5,
      {
        signal,
        force: true,
      }
    );

    expect(receivedOptions).toEqual({ signal, force: true });
  });

  it("keeps autocomplete wrapping when Pi replaces the provider", async () => {
    const editor = createEditor({});
    const provider = {
      getSuggestions() {
        return Promise.resolve({
          items: [{ value: "should-not-show", label: "should-not-show" }],
          prefix: "@",
        });
      },
      applyCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        _item: AutocompleteItem,
        _prefix: string
      ) {
        return { lines, cursorLine, cursorCol };
      },
    };

    editor.setAutocompleteProvider(provider);
    editor.setAutocompleteProvider(provider);

    const result = await editorInternals(
      editor
    ).autocompleteProvider.getSuggestions(["@"], 0, 1, {
      signal: new AbortController().signal,
    });

    expect(result).toBeNull();
  });

  it("submits the configured command on double escape when idle and editor is empty", () => {
    const submitted: string[] = [];
    const editor = createEditor(
      {},
      {
        doubleEscapeCommand: "anycopy",
        canTriggerDoubleEscapeCommand: () => true,
        interruptMatches: true,
      }
    );

    editor.onSubmit = (text) => {
      submitted.push(text);
    };

    editor.handleInput("\x1b");
    editor.handleInput("\x1b");

    expect(submitted).toEqual(["/anycopy"]);
  });

  it("supports commands that become available after editor attachment", () => {
    const submitted: string[] = [];
    let availableCommand: string | null = null;
    const editor = createEditor(
      {},
      {
        getDoubleEscapeCommand: () => availableCommand,
        canTriggerDoubleEscapeCommand: () => true,
        interruptMatches: true,
      }
    );

    editor.onSubmit = (text) => {
      submitted.push(text);
    };

    editor.handleInput("\x1b");
    editor.handleInput("\x1b");
    expect(submitted).toEqual([]);

    availableCommand = "anycopy";
    editor.handleInput("\x1b");
    editor.handleInput("\x1b");

    expect(submitted).toEqual(["/anycopy"]);
  });

  it("renders Amp chrome with rounded borders, side padding, labels, and minimum body height", () => {
    const lines = renderAmpEditorChrome({
      width: 20,
      editorLines: ["────────────────────", "body", "────────────────────"],
      labels: {
        topLeftContent: " top ",
        topRightContent: " right ",
        bottomContent: " bottom ",
      },
    });

    expect(lines).toEqual([
      "╭ top ────── right ╮",
      "│ body             │",
      "│                  │",
      "│                  │",
      "╰────────── bottom ╯",
    ]);
  });

  it("renders autocomplete and popup lines outside the Amp frame", () => {
    const lines = renderAmpEditorChrome({
      width: 16,
      editorLines: ["────────────────", "body", "────────────────", "popup"],
      labels: { topLeftContent: "", topRightContent: "", bottomContent: "" },
      minBodyHeight: 1,
    });

    expect(lines).toEqual([
      "╭──────────────╮",
      "│ body         │",
      "╰──────────────╯",
      "popup",
    ]);
  });

  it("clips Amp body lines without adding truncation ellipses", () => {
    const lines = renderAmpEditorChrome({
      width: 12,
      editorLines: ["────────────", "very long body text", "────────────"],
      labels: { topLeftContent: "", topRightContent: "", bottomContent: "" },
      minBodyHeight: 1,
    });

    expect(lines[1]).toBe("│ very lon │");
    expect(lines[1]).not.toContain("...");
  });

  it("colors Amp frame glyphs without recoloring status labels or body text", () => {
    const color = (value: string) => `\u001b[2m${value}\u001b[0m`;
    const body = "body\u001b[31mred\u001b[0m";
    const lines = renderAmpEditorChrome({
      width: 20,
      editorLines: ["────────────────────", body, "────────────────────"],
      labels: {
        topLeftContent: " top ",
        topRightContent: "",
        bottomContent: " bottom ",
      },
      minBodyHeight: 1,
      borderColor: color,
    });

    expect(lines[0]).toContain(color("╭"));
    expect(lines[0]).toContain(" top ");
    expect(lines[0]).not.toContain(color(" top "));
    expect(lines[1]).toContain(color("│"));
    expect(lines[1]).toContain(body);
    expect(lines[1]).not.toContain(color(body));
  });

  it("falls back to classic render output for narrow Amp widths", () => {
    const editorLines = ["───────────", "body", "───────────"];

    expect(
      renderAmpEditorChrome({
        width: 11,
        editorLines,
        labels: {
          topLeftContent: "top",
          topRightContent: "",
          bottomContent: "bottom",
        },
      })
    ).toBe(editorLines);
  });

  it("prioritizes native scroll indicators over Amp status labels and colors them as borders", () => {
    const color = (value: string) => `\u001b[2m${value}\u001b[0m`;
    const lines = renderAmpEditorChrome({
      width: 24,
      editorLines: ["─── ↑ 2 more ─────────", "body", "─── ↓ 3 more ─────────"],
      labels: {
        topLeftContent: "top",
        topRightContent: "right",
        bottomContent: "bottom",
      },
      minBodyHeight: 1,
      borderColor: color,
    });

    expect(lines[0]).toMatch(TOP_SCROLL_COLOR_PATTERN);
    expect(lines[0]).not.toContain("top");
    expect(lines[0]).not.toContain("right");
    expect(lines[2]).toMatch(BOTTOM_SCROLL_COLOR_PATTERN);
    expect(lines[2]).not.toContain("bottom");
  });

  it("uses Amp chrome in EnhancedEditor when configured", () => {
    const borderColor = (value: string) => `\u001b[2m${value}\u001b[0m`;
    const editor = createEditor(
      {},
      {
        editorChromeStyle: "amp",
        statusBarEnabled: true,
        statusBarContext: createStatusBarContext(),
        statusBarFooterData: createStatusBarFooterData(),
        borderColor,
      }
    );

    const lines = editor.render(60);

    expect(lines[0]).toStartWith(borderColor("╭"));
    expect(lines[0]).toContain("test-model");
    expect(lines[0]).not.toContain(borderColor("test-model"));
    expect(lines.at(-1)).toContain("main");
    expect(lines.some((line) => line.startsWith(`${borderColor("│")} `))).toBe(
      true
    );
  });

  it("wraps long Amp editor input at the framed body width", () => {
    const editor = createEditor(
      {},
      {
        editorChromeStyle: "amp",
      }
    );
    editor.setText("0123456789abcdef");

    const lines = editor.render(16);

    expect(lines).toContain("│ 0123456789a  │");
    expect(lines.some((line) => line.includes("bcdef"))).toBe(true);
  });

  it("keeps Amp frame with an empty top border when status bar is disabled", () => {
    const editor = createEditor(
      {},
      {
        editorChromeStyle: "amp",
        statusBarEnabled: false,
        statusBarContext: createStatusBarContext(),
      }
    );

    const lines = editor.render(20);

    expect(lines[0]).toBe("╭──────────────────╮");
  });

  it("keeps the original top border below the status bar", () => {
    const editor = createEditor(
      {},
      {
        statusBarEnabled: true,
        statusBarContext: createStatusBarContext(),
        statusBarFooterData: createStatusBarFooterData(),
      }
    );

    const width = 40;
    const lines = editor.render(width);

    expect(lines[0]).toContain("test-model");
    expect(lines[1]).toBe("─".repeat(width));
  });

  it("uses Amp chrome for fixed editor parts without separate status lines", () => {
    const editor = createEditor(
      {},
      {
        editorChromeStyle: "amp",
        statusBarEnabled: true,
        statusBarContext: createStatusBarContext(),
        statusBarFooterData: createStatusBarFooterData(),
      }
    );

    const parts = editor.renderFixedEditorParts(60);

    expect(parts.statusLines).toBeUndefined();
    expect(parts.editorLines[0]).toStartWith("╭");
    expect(parts.editorLines[0]).toContain("test-model");
    expect(parts.editorLines.at(-1)).toContain("main");
  });

  it("updates fixed editor status without rerendering base editor lines", () => {
    let widgetStatus = "widget-a";
    let baseRenderCount = 0;
    const originalRender = CustomEditor.prototype.render;
    CustomEditor.prototype.render = function renderWithCount(width: number) {
      baseRenderCount += 1;
      return originalRender.call(this, width);
    };

    try {
      const editor = createEditor(
        {},
        {
          statusBarEnabled: true,
          statusBarContext: createStatusBarContext(),
          statusBarFooterData: createStatusBarFooterData(
            () => new Map([["custom", widgetStatus]])
          ),
        }
      );
      const width = 140;

      const first = editor.renderFixedEditorParts(width);
      widgetStatus = "widget-b";
      const second = editor.renderFixedEditorParts(width);

      expect(baseRenderCount).toBe(1);
      expect(first.statusLines?.[0]).toContain("widget-a");
      expect(second.statusLines?.[0]).toContain("widget-b");
      expect(second.editorLines).toEqual(first.editorLines);
    } finally {
      CustomEditor.prototype.render = originalRender;
    }
  });

  it("rerenders fixed editor lines when terminal height changes", () => {
    let baseRenderCount = 0;
    const originalRender = CustomEditor.prototype.render;
    CustomEditor.prototype.render = function renderWithCount(width: number) {
      baseRenderCount += 1;
      return originalRender.call(this, width);
    };

    try {
      const editor = createEditor({});
      const tui = Reflect.get(editor, "tuiInstance") as {
        terminal: { rows: number };
      };
      const width = 40;

      editor.renderFixedEditorParts(width);
      tui.terminal.rows = 12;
      editor.renderFixedEditorParts(width);

      expect(baseRenderCount).toBe(2);
    } finally {
      CustomEditor.prototype.render = originalRender;
    }
  });

  it("rerenders fixed editor lines when editor text changes", () => {
    const editor = createEditor({});
    const width = 40;

    const first = editor.renderFixedEditorParts(width);
    editor.setText("changed text");
    const second = editor.renderFixedEditorParts(width);

    expect(second.editorLines).not.toEqual(first.editorLines);
    expect(second.editorLines.join("\n")).toContain("changed text");
  });

  it("skips the status bar once the context is detached", () => {
    const options: Parameters<typeof createEditor>[1] = {
      statusBarEnabled: true,
      statusBarContext: createStatusBarContext(),
      statusBarFooterData: createStatusBarFooterData(),
    };

    const editor = createEditor({}, options);
    options.statusBarContext = null;

    const width = 40;
    const lines = editor.render(width);
    const detachedEditor = createEditor(
      {},
      {
        statusBarEnabled: true,
        statusBarContext: null,
        statusBarFooterData: options.statusBarFooterData,
      }
    );

    expect(lines).toEqual(detachedEditor.render(width));
    expect(lines.join("\n")).not.toContain("test-model");
  });
});
