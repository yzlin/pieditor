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
  terminalRows?: number;
  terminalWrite?: (data: string) => void;
  copyText?: (text: string) => void | Promise<void>;
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

function writePieditorConfig(homeDir: string): void {
  const configPath = join(homeDir, ".pi", "agent", "pieditor.json");
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
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
      // Mock TUI compatibility stub.
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
  writePieditorConfig(homeDir);

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
    copyText: options.copyText,
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
  process.env.HOME = originalHome;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("pieditor double-submit delivery", () => {
  it("sends immediately while idle and queues a follow-up while busy", () => {
    const idleHarness = createHarness({});
    const idleEditor = idleHarness.createEditor();
    idleEditor.handleInput("ctrl+j");
    idleEditor.handleInput("ctrl+j");
    expect(idleHarness.sentMessages).toEqual([{ message: "continue" }]);

    const busyHarness = createHarness({});
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
      copyText: (text) => {
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
      copyText: (text) => {
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
      copyText: () => {
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
      copyText: (text) => {
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
      overlayVisible: true,
      copyText: (text) => {
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
