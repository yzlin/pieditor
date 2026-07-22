import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  initTheme,
  type KeybindingsManager,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { createPieditorComposition } from "./composition";
import { clearAboveEditorSurfaceLeases } from "./fixed-editor/above-editor-lease";
import {
  acquireReplacementSurfaceLease,
  clearReplacementSurfaceLeases,
  getActiveReplacementLeaseDiagnostics,
} from "./fixed-editor/replacement-lease";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

beforeAll(() => {
  initTheme("dark");
});

type EditorFactory = NonNullable<
  Parameters<ExtensionUIContext["setEditorComponent"]>[0]
>;
type FooterFactory = NonNullable<
  Parameters<ExtensionUIContext["setFooter"]>[0]
>;

interface HarnessOptions {
  fixedEditorEnabled: boolean;
  terminalRows?: number;
  terminalWrite?: (data: string) => void;
  copySelection?: (text: string) => void | Promise<void>;
  rootLines?: string[];
  overlayVisible?: boolean;
}

interface MockTui {
  terminal: {
    columns: number;
    rows: number;
    kittyProtocolActive: boolean;
    write?: (data: string) => void;
  };
  render: (width: number) => string[];
  doRender: () => void;
  addInputListener: (
    listener: (data: string) => { consume?: boolean; data?: string } | undefined
  ) => () => void;
  listeners: Array<
    (data: string) => { consume?: boolean; data?: string } | undefined
  >;
  requestRender: () => void;
  getShowHardwareCursor: () => boolean;
  hasOverlay: () => boolean;
  compositeLineAt: (
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number
  ) => string;
  requestRenderCount: number;
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pieditor-composition-"));
  tempRoots.push(dir);
  return dir;
}

function writePieditorConfig(
  homeDir: string,
  fixedEditorEnabled: boolean
): void {
  const configPath = join(homeDir, ".pi", "agent", "pieditor.json");
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      fixedEditor: { enabled: fixedEditorEnabled },
      filePicker: { previewHighlightMode: "builtin" },
      statusBar: { enabled: false },
    }),
    "utf-8"
  );
}

function createMockTui(options: HarnessOptions): MockTui {
  const listeners: Array<
    (data: string) => { consume?: boolean; data?: string } | undefined
  > = [];

  return {
    terminal: {
      columns: 80,
      rows: options.terminalRows ?? 24,
      kittyProtocolActive: false,
      write: options.terminalWrite,
    },
    render: () => options.rootLines ?? ["chat"],
    doRender() {
      // The compositor patches this method during install.
    },
    addInputListener(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    listeners,
    requestRender() {
      this.requestRenderCount += 1;
    },
    getShowHardwareCursor: () => true,
    hasOverlay: () => options.overlayVisible ?? false,
    compositeLineAt: (baseLine) => baseLine,
    requestRenderCount: 0,
  };
}

const ROOT_SCROLLBAR_PATTERN = new RegExp(
  ` *${String.raw`\x1b`}\\[(?:2;90|97)m█${String.raw`\x1b`}\\[0m$`
);

function rootContent(lines: string[] | undefined): string[] {
  return (lines ?? []).map((line) => line.replace(ROOT_SCROLLBAR_PATTERN, ""));
}

function createFooterData(): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map<string, string>(),
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => undefined,
  } as ReadonlyFooterDataProvider;
}

function createHarness(options: HarnessOptions) {
  const root = createTempDir();
  const homeDir = join(root, "home");
  process.env.HOME = homeDir;
  writePieditorConfig(homeDir, options.fixedEditorEnabled);

  let editorFactory: EditorFactory | undefined;
  let footerFactory: FooterFactory | undefined;
  const notifications: Array<{ message: string; level: string | undefined }> =
    [];

  const sentMessages: Array<{ message: string; options?: { deliverAs: string } }> = [];
  const pi = {
    getCommands: () => [],
    sendUserMessage(message: string, sendOptions?: { deliverAs: string }) {
      sentMessages.push({ message, options: sendOptions });
    },
  } as unknown as ExtensionAPI;

  const terminalInputHandlers: Array<
    (data: string) => { consume?: boolean; data?: string } | undefined
  > = [];
  const ui = {
    setEditorComponent(factory: EditorFactory | undefined) {
      editorFactory = factory;
    },
    setFooter(factory: FooterFactory | undefined) {
      footerFactory = factory;
    },
    select: async () => "original-select",
    confirm: async () => true,
    onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined) {
      terminalInputHandlers.push(handler);
      return () => {
        const index = terminalInputHandlers.indexOf(handler);
        if (index !== -1) {
          terminalInputHandlers.splice(index, 1);
        }
      };
    },
    notify(message: string, level?: string) {
      notifications.push({ message, level });
    },
    theme: {},
  } as unknown as ExtensionUIContext;

  let idle = true;
  const ctx = {
    hasUI: true,
    ui,
    isIdle: () => idle,
    hasPendingMessages: () => false,
  } as unknown as ExtensionContext;

  const composition = createPieditorComposition(pi, {
    copySelection: options.copySelection,
  });
  composition.attachEditor(ctx);

  if (!(editorFactory && footerFactory)) {
    throw new Error("pieditor did not register editor and footer factories");
  }

  const createEditorComponent = editorFactory;
  const createFooterComponent = footerFactory;
  const tui = createMockTui(options);
  const theme = {
    borderColor: (value: string) => value,
    selectList: {},
  } as unknown as EditorTheme;
  const keybindings = {
    matches: (data: string, key: string) =>
      data === "ctrl+j" && key === "tui.input.submit",
    getKeys: () => [],
  } as unknown as KeybindingsManager;

  return {
    composition,
    footerData: createFooterData(),
    footerFactory: createFooterComponent,
    keybindings,
    ctx,
    notifications,
    sentMessages,
    setIdle(value: boolean) {
      idle = value;
    },
    terminalInputHandlers,
    theme,
    tui,
    ui,
    createEditor() {
      return createEditorComponent(tui as unknown as TUI, theme, keybindings);
    },
    createFooter() {
      return createFooterComponent(
        tui as unknown as TUI,
        {} as unknown as Theme,
        this.footerData
      );
    },
  };
}

afterEach(() => {
  clearAboveEditorSurfaceLeases();
  clearReplacementSurfaceLeases();
  process.env.HOME = originalHome;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("pieditor double-submit delivery", () => {
  it("sends immediately while idle and queues a follow-up while busy", () => {
    const idleHarness = createHarness({ fixedEditorEnabled: false });
    const idleEditor = idleHarness.createEditor();
    idleEditor.handleInput("ctrl+j");
    idleEditor.handleInput("ctrl+j");
    expect(idleHarness.sentMessages).toEqual([{ message: "continue" }]);

    const busyHarness = createHarness({ fixedEditorEnabled: false });
    busyHarness.setIdle(false);
    const busyEditor = busyHarness.createEditor();
    busyEditor.handleInput("ctrl+j");
    busyEditor.handleInput("ctrl+j");
    expect(busyHarness.sentMessages).toEqual([
      { message: "continue", options: { deliverAs: "followUp" } },
    ]);
  });
});

describe("pieditor editor buffer copy", () => {
  it("copies the active editor getText() exactly", async () => {
    const copied: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: false,
      copySelection: (text) => {
        copied.push(text);
      },
    });
    const editor = harness.createEditor();
    editor.setText(" first line\nsecond line\n");

    await harness.composition.copyEditorBuffer(harness.ctx);

    expect(copied).toEqual([" first line\nsecond line\n"]);
    expect(harness.notifications).toContainEqual({
      message: "Copied 24 characters from editor",
      level: "info",
    });
  });

  it("does not write clipboard for an empty editor buffer", async () => {
    const copied: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: false,
      copySelection: (text) => {
        copied.push(text);
      },
    });
    harness.createEditor();

    await harness.composition.copyEditorBuffer(harness.ctx);

    expect(copied).toEqual([]);
    expect(harness.notifications).toContainEqual({
      message: "Editor buffer empty",
      level: "info",
    });
  });

  it("warns with error text when clipboard copy fails", async () => {
    const harness = createHarness({
      fixedEditorEnabled: false,
      copySelection: () => {
        throw new Error("clipboard denied");
      },
    });
    const editor = harness.createEditor();
    editor.setText("copy me");

    await harness.composition.copyEditorBuffer(harness.ctx);

    expect(harness.notifications).toContainEqual({
      message: "Editor copy failed: clipboard denied",
      level: "warning",
    });
  });

  it("does not copy when the editor is not ready", async () => {
    const copied: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: false,
      copySelection: (text) => {
        copied.push(text);
      },
    });

    await harness.composition.copyEditorBuffer(harness.ctx);

    expect(copied).toEqual([]);
    expect(harness.notifications).toContainEqual({
      message: "Editor not ready",
      level: "warning",
    });
  });

  it("does not copy while overlay UI is active", async () => {
    const copied: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: false,
      overlayVisible: true,
      copySelection: (text) => {
        copied.push(text);
      },
    });
    const editor = harness.createEditor();
    editor.setText("copy me");

    await harness.composition.copyEditorBuffer(harness.ctx);

    expect(copied).toEqual([]);
    expect(harness.notifications).toContainEqual({
      message: "Editor not ready",
      level: "warning",
    });
  });
});

describe("pieditor fixed editor composition", () => {
  it("installs after editor and footer refs are available", () => {
    const writes: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: (data) => writes.push(data),
    });

    const editor = harness.createEditor();
    expect(editor.render(80).length).toBeGreaterThan(0);

    const footer = harness.createFooter();
    expect(writes.length).toBeGreaterThan(0);
    expect(editor.render(80)).toEqual([]);

    footer.dispose?.();
    expect(editor.render(80).length).toBeGreaterThan(0);
  });

  it("toggles fixed editor live and disposes on detach", () => {
    const harness = createHarness({
      fixedEditorEnabled: false,
      terminalWrite: () => undefined,
    });

    const editor = harness.createEditor();
    harness.createFooter();
    expect(editor.render(80).length).toBeGreaterThan(0);

    harness.composition.setFixedEditorEnabled(true);
    expect(editor.render(80)).toEqual([]);

    harness.composition.setFixedEditorEnabled(false);
    expect(editor.render(80).length).toBeGreaterThan(0);

    harness.composition.setFixedEditorEnabled(true);
    expect(editor.render(80)).toEqual([]);

    harness.composition.detachEditor();
    expect(editor.render(80).length).toBeGreaterThan(0);
  });

  it("starts fixed editor suppressed when enabled while a replacement lease is active", () => {
    const harness = createHarness({
      fixedEditorEnabled: false,
      rootLines: ["chat"],
      terminalWrite: () => undefined,
    });

    const editor = harness.createEditor();
    harness.createFooter();
    acquireReplacementSurfaceLease({
      owner: "file-picker",
      id: "overlay",
      target: editor,
    });

    harness.composition.setFixedEditorEnabled(true);

    expect(getActiveReplacementLeaseDiagnostics()).toEqual([
      { owner: "file-picker", id: "overlay" },
    ]);
    expect(editor.render(80).length).toBeGreaterThan(0);
    expect(rootContent(harness.tui.render(80)).filter(Boolean)).toEqual([
      "chat",
    ]);
  });

  it("clears active replacement leases on detach", () => {
    const harness = createHarness({
      fixedEditorEnabled: false,
      terminalWrite: () => undefined,
    });

    const editor = harness.createEditor();
    harness.createFooter();
    acquireReplacementSurfaceLease({
      owner: "file-picker",
      id: "overlay",
      target: editor,
    });
    harness.composition.setFixedEditorEnabled(true);
    expect(getActiveReplacementLeaseDiagnostics()).toHaveLength(1);

    harness.composition.detachEditor();

    expect(getActiveReplacementLeaseDiagnostics()).toEqual([]);
    expect(editor.render(80).length).toBeGreaterThan(0);
  });

  it("fails open with a warning when compositor install fails", () => {
    const harness = createHarness({ fixedEditorEnabled: true });

    const editor = harness.createEditor();
    harness.createFooter();

    expect(editor.render(80).length).toBeGreaterThan(0);
    expect(harness.notifications).toContainEqual({
      message:
        "pieditor fixed-editor could not attach; using the normal editor",
      level: "warning",
    });
  });

  it("jumps fixed-editor root to bottom when a user message starts", () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      rootLines: ["root-1", "root-2", "root-3", "root-4", "root-5", "root-6"],
      terminalRows: 5,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    expect(rootContent(harness.tui.render(80))).toEqual(["root-5", "root-6"]);
    expect(harness.tui.listeners[0]?.("\u001b[1;9A")).toEqual({
      consume: true,
    });
    expect(rootContent(harness.tui.render(80))).toEqual(["root-1", "root-2"]);

    harness.composition.handleMessageStart({ message: { role: "assistant" } });
    expect(rootContent(harness.tui.render(80))).toEqual(["root-1", "root-2"]);

    harness.composition.handleMessageStart({ message: { role: "user" } });
    expect(rootContent(harness.tui.render(80))).toEqual(["root-5", "root-6"]);
  });

  it("jumps fixed-editor root to bottom for busy interactive input", () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      rootLines: ["root-1", "root-2", "root-3", "root-4", "root-5", "root-6"],
      terminalRows: 5,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();
    harness.tui.render(80);

    expect(harness.tui.listeners[0]?.("\u001b[1;9A")).toEqual({
      consume: true,
    });
    expect(rootContent(harness.tui.render(80))).toEqual(["root-1", "root-2"]);

    harness.composition.handleInput({ source: "extension" }, {
      isIdle: () => false,
    } as ExtensionContext);
    expect(rootContent(harness.tui.render(80))).toEqual(["root-1", "root-2"]);

    harness.composition.handleInput({ source: "interactive" }, {
      isIdle: () => true,
    } as ExtensionContext);
    expect(rootContent(harness.tui.render(80))).toEqual(["root-1", "root-2"]);

    harness.composition.handleInput({ source: "interactive" }, {
      isIdle: () => false,
    } as ExtensionContext);
    expect(rootContent(harness.tui.render(80))).toEqual(["root-5", "root-6"]);
  });

  it("falls back to original select and confirm when fixed editor is not installed", async () => {
    const harness = createHarness({ fixedEditorEnabled: false });

    expect(await harness.ui.select("Title", ["A"])).toBe("original-select");
    expect(await harness.ui.confirm("Title", "Message")).toBe(true);
    expect(harness.terminalInputHandlers).toHaveLength(0);
  });

  it("falls back to original select and confirm while an overlay is visible", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      overlayVisible: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    expect(await harness.ui.select("Title", ["A"])).toBe("original-select");
    expect(await harness.ui.confirm("Title", "Message")).toBe(true);
    expect(harness.terminalInputHandlers).toHaveLength(0);
  });

  it("falls back to original select while a replacement lease is active", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    const replacement = { render: () => ["replacement"] };
    harness.createEditor();
    harness.createFooter();
    const lease = acquireReplacementSurfaceLease({
      owner: "test",
      id: "replacement",
      target: replacement,
    });

    expect(await harness.ui.select("Title", ["A"])).toBe("original-select");
    expect(await harness.ui.confirm("Title", "Message")).toBe(true);
    expect(harness.terminalInputHandlers).toHaveLength(0);

    lease.release();
  });

  it("passes replacement input through and resolves active fixed selects", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    const replacement = { render: () => ["replacement"] };
    harness.createEditor();
    harness.createFooter();

    const active = harness.ui.select("Active", ["A"]);
    const queued = harness.ui.select("Queued", ["B"]);
    expect(harness.terminalInputHandlers).toHaveLength(1);

    const lease = acquireReplacementSurfaceLease({
      owner: "test",
      id: "replacement",
      target: replacement,
    });

    expect(await active).toBeUndefined();
    expect(await queued).toBeUndefined();
    expect(harness.terminalInputHandlers).toHaveLength(0);
    expect(harness.tui.listeners[0]?.("x")).toBeUndefined();

    lease.release();
  });

  it("maps fixed confirm to Yes and No semantics", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    const yes = harness.ui.confirm("Confirm", "Proceed?");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await yes).toBe(true);

    const no = harness.ui.confirm("Confirm", "Proceed?");
    harness.terminalInputHandlers.at(-1)?.("\u001b[B");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await no).toBe(false);
  });

  it("serializes concurrent fixed select prompts", async () => {
    const writes: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: (data) => writes.push(data),
    });
    harness.createEditor();
    harness.createFooter();

    const first = harness.ui.select("First", ["A", "B"]);
    const second = harness.ui.select("Second", ["C", "D"]);

    expect(harness.terminalInputHandlers).toHaveLength(1);
    expect(writes.join("\n")).toContain("First");
    expect(writes.join("\n")).toContain("navigate");
    expect(writes.join("\n")).toContain("select");
    harness.terminalInputHandlers.at(-1)?.("\u001b[B");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await first).toBe("B");

    expect(writes.join("\n")).toContain("Second");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await second).toBe("C");
  });

  it("handles fixed select keybinding variants", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    const selected = harness.ui.select("Keys", ["A", "B"]);
    harness.terminalInputHandlers.at(-1)?.("\u001bOB");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await selected).toBe("B");

    const canceled = harness.ui.select("Cancel", ["A"]);
    harness.terminalInputHandlers.at(-1)?.("\u0003");
    expect(await canceled).toBeUndefined();
  });

  it("consumes unhandled fixed select input while active", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    const selected = harness.ui.select("Keys", ["A"]);
    expect(harness.terminalInputHandlers.at(-1)?.("x")).toEqual({
      consume: true,
    });
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await selected).toBe("A");
  });

  it("resolves queued fixed selects immediately on abort", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();
    const queuedAbort = new AbortController();

    const active = harness.ui.select("Active", ["A"]);
    const queued = harness.ui.select("Queued", ["B"], {
      signal: queuedAbort.signal,
    });
    queuedAbort.abort();

    await expect(queued).resolves.toBeUndefined();
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await active).toBe("A");
  });

  it("resolves open and queued fixed selects as undefined on abort", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();
    const openAbort = new AbortController();
    const queuedAbort = new AbortController();

    const open = harness.ui.select("Open", ["A"], { signal: openAbort.signal });
    const queued = harness.ui.select("Queued", ["B"], {
      signal: queuedAbort.signal,
    });
    queuedAbort.abort();
    openAbort.abort();

    expect(await open).toBeUndefined();
    expect(await queued).toBeUndefined();
  });

  it("resolves open and queued fixed selects on detach", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    const open = harness.ui.select("Open", ["A"]);
    const queued = harness.ui.select("Queued", ["B"]);
    expect(harness.terminalInputHandlers).toHaveLength(1);

    harness.composition.detachEditor();

    expect(await open).toBeUndefined();
    expect(await queued).toBeUndefined();
    expect(harness.terminalInputHandlers).toHaveLength(0);
  });

  it("resolves open fixed selects when fixed editor is disabled", async () => {
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalWrite: () => undefined,
    });
    harness.createEditor();
    harness.createFooter();

    const open = harness.ui.select("Open", ["A"]);
    expect(harness.terminalInputHandlers).toHaveLength(1);

    harness.composition.setFixedEditorEnabled(false);

    expect(await open).toBeUndefined();
    expect(harness.terminalInputHandlers).toHaveLength(0);
  });

  it("keeps selected fixed select row visible while scrolling options", async () => {
    const writes: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalRows: 16,
      terminalWrite: (data) => writes.push(data),
    });
    harness.createEditor();
    harness.createFooter();
    const options = Array.from({ length: 12 }, (_, index) => `Option ${index + 1}`);

    const selected = harness.ui.select("Pick", options);
    for (let index = 0; index < 10; index += 1) {
      harness.terminalInputHandlers.at(-1)?.("\u001b[B");
    }

    const rendered = writes.at(-1) ?? "";
    expect(rendered).toContain("Option 11");
    expect(rendered).not.toContain("Option 2");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await selected).toBe("Option 11");
  });

  it("keeps selected fixed select row visible in a short terminal", async () => {
    const writes: string[] = [];
    const harness = createHarness({
      fixedEditorEnabled: true,
      terminalRows: 10,
      terminalWrite: (data) => writes.push(data),
    });
    harness.createEditor();
    harness.createFooter();
    const options = Array.from({ length: 12 }, (_, index) => `Option ${index + 1}`);

    const selected = harness.ui.select("Pick", options);
    for (let index = 0; index < 10; index += 1) {
      harness.terminalInputHandlers.at(-1)?.("\u001b[B");
    }

    const rendered = writes.at(-1) ?? "";
    expect(rendered).toContain("Option 11");
    harness.terminalInputHandlers.at(-1)?.("\r");
    expect(await selected).toBe("Option 11");
  });
});
