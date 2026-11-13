import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ExtensionCommandContext,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { loadConfig } from "./config/index.js";
import {
  parseSettingInput,
  PRESET_VALUE,
  SETTING_DEFINITIONS,
  setPath,
  writeSetting,
} from "./config/settings.js";
import { openPieditorSettings } from "./settings-command.js";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

beforeAll(() => {
  initTheme("dark");
});

afterEach(() => {
  process.env.HOME = originalHome;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createDirs() {
  const root = mkdtempSync(join(tmpdir(), "pieditor-settings-"));
  tempRoots.push(root);
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  const globalPath = join(homeDir, ".pi", "agent", "pieditor.json");
  const projectPath = join(cwd, ".pi", "pieditor.json");
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  process.env.HOME = homeDir;
  return { homeDir, cwd, globalPath, projectPath };
}

function definition(id: string) {
  const found = SETTING_DEFINITIONS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing setting ${id}`);
  }
  return found;
}

const ENTER = "\r";
const DOWN = "\u001b[B";

async function openUi(cwd: string) {
  const notifications: Array<{ message: string; level?: string }> = [];
  let reloads = 0;
  let component: Component | undefined;
  let closed = false;

  const ctx = {
    mode: "tui",
    cwd,
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      custom(factory: (...args: unknown[]) => Component) {
        const theme = {
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        } as unknown as Theme;
        component = factory({ requestRender: () => undefined }, theme, {}, () => {
          closed = true;
        });
        return Promise.resolve();
      },
    },
  } as unknown as ExtensionCommandContext;

  await openPieditorSettings(ctx, {
    reloadConfig() {
      reloads += 1;
    },
  });

  if (!component) {
    throw new Error("settings UI did not open");
  }
  const ui = component;
  return {
    notifications,
    get reloads() {
      return reloads;
    },
    get closed() {
      return closed;
    },
    press(...keys: string[]) {
      for (const key of keys) {
        ui.handleInput?.(key);
      }
    },
    type(text: string) {
      for (const char of text) {
        ui.handleInput?.(char);
      }
    },
    render: () => ui.render(120).join("\n"),
  };
}

describe("pieditor settings model", () => {
  it("sets and prunes dotted paths without touching other keys", () => {
    const source = { commandRemap: { tree: "anycopy" }, doublePaste: { windowMs: 900 } };
    expect(setPath(source, "doublePaste.enabled", false)).toEqual({
      commandRemap: { tree: "anycopy" },
      doublePaste: { windowMs: 900, enabled: false },
    });
    expect(setPath(source, "doublePaste.windowMs", undefined)).toEqual({
      commandRemap: { tree: "anycopy" },
    });
  });

  it("parses inputs per setting kind", () => {
    expect(parseSettingInput(definition("doublePaste.windowMs"), "750")).toEqual({
      ok: true,
      value: 750,
    });
    expect(parseSettingInput(definition("doublePaste.windowMs"), "1.5").ok).toBe(false);
    expect(parseSettingInput(definition("doubleEscapeCommand"), "  ")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseSettingInput(definition("doubleSubmitMessage"), "")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      parseSettingInput(definition("statusBar.segmentOptions.git.showBranch"), PRESET_VALUE),
    ).toEqual({ ok: true, value: undefined });
  });

  it("writes every scalar setting to a form loadConfig accepts", () => {
    const { homeDir, cwd, globalPath } = createDirs();
    const samples: Record<string, string> = {
      boolean: "false",
      enum: "",
      string: "custom value",
      positiveInteger: "42",
    };

    for (const entry of SETTING_DEFINITIONS) {
      const input =
        entry.kind === "enum" ? entry.values[entry.values.length - 1] : samples[entry.kind];
      const parsed = parseSettingInput(entry, input);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      writeSetting(globalPath, entry.id, parsed.value);
    }

    const config = loadConfig({ homeDir, cwd }) as unknown as Record<string, unknown>;
    for (const entry of SETTING_DEFINITIONS) {
      const value = entry.id
        .split(".")
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], config);
      const expected =
        entry.kind === "enum"
          ? entry.values[entry.values.length - 1]
          : entry.kind === "boolean"
            ? false
            : entry.kind === "positiveInteger"
              ? 42
              : "custom value";
      expect({ id: entry.id, value }).toEqual({ id: entry.id, value: expected });
    }
  });
});

describe("/pieditor settings UI", () => {
  it("edits the double-submit message, keeps other keys, and reloads", async () => {
    const { homeDir, cwd, globalPath } = createDirs();
    writeFileSync(globalPath, JSON.stringify({ commandRemap: { tree: "anycopy" } }));

    const ui = await openUi(cwd);
    expect(ui.render()).toContain("Double-submit message");
    expect(ui.render()).toContain("continue");

    // First row is the double-submit message; enter opens its text submenu.
    ui.press(ENTER);
    for (let i = 0; i < "continue".length; i += 1) {
      ui.press("\u007f");
    }
    ui.type("keep going");
    ui.press(ENTER);

    expect(JSON.parse(readFileSync(globalPath, "utf-8"))).toEqual({
      commandRemap: { tree: "anycopy" },
      doubleSubmitMessage: "keep going",
    });
    expect(loadConfig({ homeDir, cwd }).doubleSubmitMessage).toBe("keep going");
    expect(ui.reloads).toBe(1);
    expect(ui.render()).toContain("keep going");
  });

  it("cycles boolean settings and warns about project overrides", async () => {
    const { cwd, globalPath, projectPath } = createDirs();
    writeFileSync(projectPath, JSON.stringify({ doublePaste: { enabled: true } }));

    const ui = await openUi(cwd);
    const index = SETTING_DEFINITIONS.findIndex((entry) => entry.id === "doublePaste.enabled");
    ui.press(...Array.from({ length: index }, () => DOWN), ENTER);

    expect(JSON.parse(readFileSync(globalPath, "utf-8"))).toEqual({
      doublePaste: { enabled: false },
    });
    expect(ui.notifications).toContainEqual({
      message: `pieditor: ${projectPath} also sets doublePaste.enabled; the project value wins`,
      level: "warning",
    });
  });

  it("refuses to open when the global config is not valid JSON", async () => {
    const { cwd, globalPath } = createDirs();
    writeFileSync(globalPath, "{ not json");

    const notifications: string[] = [];
    let opened = false;
    await openPieditorSettings(
      {
        mode: "tui",
        cwd,
        ui: {
          notify: (message: string) => notifications.push(message),
          custom: () => {
            opened = true;
          },
        },
      } as unknown as ExtensionCommandContext,
      { reloadConfig: () => undefined },
    );

    expect(opened).toBe(false);
    expect(notifications[0]).toContain(`cannot edit ${globalPath}`);
    expect(readFileSync(globalPath, "utf-8")).toBe("{ not json");
  });
});
