import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  hasProjectFixedEditorEnabledOverride,
  loadConfig,
  resolveRuntimeConfig,
  saveGlobalFixedEditorEnabled,
} from "./config";
import { DEFAULT_FIXED_EDITOR_CONFIG } from "./config/fixed-editor";
import { DEFAULT_FILE_PICKER_CONFIG } from "./file-picker-config";

describe("pieditor config", () => {
  it("merges command and nested file picker config with project precedence", () => {
    const config = resolveRuntimeConfig(
      {
        doubleEscapeCommand: "global-command",
        commandRemap: {
          tree: "global-tree",
          test: "global-test",
        },
        editorChrome: {
          style: "amp",
        },
        filePicker: {
          respectGitignore: false,
          skipHidden: true,
          allowFolderSelection: false,
          skipPatterns: ["global"],
          tabCompletionMode: "segment",
          previewHighlightMode: "builtin",
        },
        statusBar: {
          enabled: false,
          preset: "minimal",
          leftSegments: ["path"],
          rightSegments: ["context_pct"],
          separator: " / ",
          colors: {
            path: "warning",
            separator: "dim",
          },
          segmentOptions: {
            path: { mode: "abbreviated", maxLength: 20 },
            git: { showUntracked: true },
          },
        },
        fixedEditor: {
          enabled: true,
          mouseScroll: true,
          scrollUpShortcuts: ["super+up"],
          scrollDownShortcuts: ["super+down"],
        },
      },
      {
        doubleEscapeCommand: "project-command",
        commandRemap: {
          tree: "project-tree",
        },
        filePicker: {
          skipHidden: false,
          skipPatterns: ["project"],
        },
        statusBar: {
          preset: "compact",
          leftSegments: ["model", "git"],
          rightSegments: [],
          separator: " | ",
          colors: {
            model: "success",
            context: "#89d281",
          },
          segmentOptions: {
            path: { maxLength: 12 },
            model: { showThinkingLevel: true },
          },
        },
        fixedEditor: {
          mouseScroll: false,
          scrollUpShortcuts: "ctrl+shift+up",
          scrollDownShortcuts: ["ctrl+shift+down", "super+down"],
        },
      }
    );

    expect(config).toEqual({
      doubleEscapeCommand: "project-command",
      commandRemap: {
        tree: "project-tree",
        test: "global-test",
      },
      editorChrome: {
        style: "amp",
      },
      doublePaste: {
        enabled: true,
        windowMs: 1000,
      },
      filePicker: {
        ...DEFAULT_FILE_PICKER_CONFIG,
        respectGitignore: false,
        skipHidden: false,
        allowFolderSelection: false,
        skipPatterns: ["project"],
        tabCompletionMode: "segment",
        previewHighlightMode: "builtin",
      },
      statusBar: {
        enabled: false,
        preset: "compact",
        leftSegments: ["model", "git"],
        rightSegments: [],
        separator: " | ",
        colors: {
          path: "warning",
          separator: "dim",
          model: "success",
          context: "#89d281",
        },
        segmentOptions: {
          path: { mode: "abbreviated", maxLength: 12 },
          git: { showUntracked: true },
          model: { showThinkingLevel: true },
        },
      },
      fixedEditor: {
        enabled: true,
        mouseScroll: false,
        scrollUpShortcuts: ["ctrl+shift+up"],
        scrollDownShortcuts: ["ctrl+shift+down", "super+down"],
      },
    });
  });

  it("defaults double paste config", () => {
    expect(resolveRuntimeConfig(null, null).doublePaste).toEqual({
      enabled: true,
      windowMs: 1000,
    });
  });

  it("merges double paste fields independently with project precedence", () => {
    const config = resolveRuntimeConfig(
      { doublePaste: { enabled: false, windowMs: 750 } },
      { doublePaste: { enabled: true } }
    );

    expect(config.doublePaste).toEqual({ enabled: true, windowMs: 750 });
  });

  it("rejects non-positive, non-integer, and non-finite double paste windows", () => {
    for (const windowMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        resolveRuntimeConfig({ doublePaste: { windowMs } }, null).doublePaste
          .windowMs
      ).toBe(1000);
    }
  });

  it("ignores invalid double paste fields in each config layer", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const globalConfigPath = join(homeDir, ".pi", "agent", "pieditor.json");
    const projectConfigPath = join(cwd, ".pi", "pieditor.json");

    mkdirSync(dirname(globalConfigPath), { recursive: true });
    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({ doublePaste: { enabled: false, windowMs: 625 } })
    );
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ doublePaste: { enabled: "yes", windowMs: 1.5 } })
    );

    try {
      expect(loadConfig({ homeDir, cwd }).doublePaste).toEqual({
        enabled: false,
        windowMs: 625,
      });

      writeFileSync(
        globalConfigPath,
        JSON.stringify({
          doublePaste: { enabled: 1, windowMs: 0 },
        })
      );
      writeFileSync(
        projectConfigPath,
        JSON.stringify({
          doublePaste: { enabled: null, windowMs: Number.POSITIVE_INFINITY },
        })
      );

      expect(loadConfig({ homeDir, cwd }).doublePaste).toEqual({
        enabled: true,
        windowMs: 1000,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses defaults when file picker config is omitted", () => {
    const config = resolveRuntimeConfig(
      {
        doubleEscapeCommand: "global-command",
      },
      {
        commandRemap: {
          tree: "anycopy",
        },
      }
    );

    expect(config).toEqual({
      doubleEscapeCommand: "global-command",
      commandRemap: {
        tree: "anycopy",
      },
      editorChrome: {
        style: "classic",
      },
      doublePaste: {
        enabled: true,
        windowMs: 1000,
      },
      filePicker: DEFAULT_FILE_PICKER_CONFIG,
      statusBar: {
        enabled: true,
        preset: "default",
      },
      fixedEditor: DEFAULT_FIXED_EDITOR_CONFIG,
    });
  });

  it("defaults editor chrome style to classic", () => {
    expect(resolveRuntimeConfig(null, null).editorChrome).toEqual({
      style: "classic",
    });
  });

  it("uses amp editor chrome style when configured", () => {
    expect(
      resolveRuntimeConfig({ editorChrome: { style: "amp" } }, null)
        .editorChrome
    ).toEqual({ style: "amp" });
  });

  it("ignores invalid editor chrome style and falls back through layers", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const globalConfigPath = join(homeDir, ".pi", "agent", "pieditor.json");
    const projectConfigPath = join(cwd, ".pi", "pieditor.json");

    mkdirSync(dirname(globalConfigPath), { recursive: true });
    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({ editorChrome: { style: "amp" } })
    );
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ editorChrome: { style: "modern" } })
    );

    try {
      expect(loadConfig({ homeDir, cwd }).editorChrome).toEqual({
        style: "amp",
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("merges editor chrome with project precedence", () => {
    expect(
      resolveRuntimeConfig(
        { editorChrome: { style: "classic" } },
        { editorChrome: { style: "amp" } }
      ).editorChrome
    ).toEqual({ style: "amp" });
  });

  it("falls back to global status bar segments when project does not override them", () => {
    const config = resolveRuntimeConfig(
      {
        statusBar: {
          preset: "minimal",
          leftSegments: ["path"],
          rightSegments: ["context_pct"],
        },
      },
      {
        statusBar: {
          preset: "compact",
        },
      }
    );

    expect(config.statusBar).toEqual({
      enabled: true,
      preset: "compact",
      leftSegments: ["path"],
      rightSegments: ["context_pct"],
    });
  });

  it("merges status bar colors by semantic key", () => {
    const config = resolveRuntimeConfig(
      {
        statusBar: {
          colors: {
            model: "warning",
            separator: "dim",
          },
        },
      },
      {
        statusBar: {
          colors: {
            model: "success",
            context: "#89d281",
          },
        },
      }
    );

    expect(config.statusBar.colors).toEqual({
      model: "success",
      separator: "dim",
      context: "#89d281",
    });
  });

  it("merges status bar segment options by nested field", () => {
    const config = resolveRuntimeConfig(
      {
        statusBar: {
          segmentOptions: {
            path: { mode: "abbreviated", maxLength: 24 },
            git: { showUntracked: true, showStaged: false },
          },
        },
      },
      {
        statusBar: {
          segmentOptions: {
            path: { maxLength: 12 },
            git: { showBranch: false },
            time: { format: "12h" },
          },
        },
      }
    );

    expect(config.statusBar.segmentOptions).toEqual({
      path: { mode: "abbreviated", maxLength: 12 },
      git: { showUntracked: true, showStaged: false, showBranch: false },
      time: { format: "12h" },
    });
  });

  it("loads fixed editor defaults and normalized project overrides", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");

    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "pieditor.json"),
      JSON.stringify({
        fixedEditor: {
          enabled: true,
          mouseScroll: false,
          scrollUpShortcuts: [" ctrl+shift+up ", ""],
          scrollDownShortcuts: "super+down",
        },
      })
    );

    try {
      const config = loadConfig({ homeDir, cwd });
      expect(config.fixedEditor).toEqual({
        enabled: true,
        mouseScroll: false,
        scrollUpShortcuts: ["ctrl+shift+up"],
        scrollDownShortcuts: ["super+down"],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("saves global fixed editor enabled without overwriting other config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const globalConfigPath = join(homeDir, ".pi", "agent", "pieditor.json");

    mkdirSync(dirname(globalConfigPath), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({
        commandRemap: { tree: "anycopy" },
        fixedEditor: { mouseScroll: false },
      })
    );

    try {
      const result = saveGlobalFixedEditorEnabled(true, { homeDir, cwd });
      const saved = JSON.parse(readFileSync(globalConfigPath, "utf-8"));

      expect(result.ok).toBe(true);
      expect(saved).toEqual({
        commandRemap: { tree: "anycopy" },
        fixedEditor: { mouseScroll: false, enabled: true },
      });
      expect(
        readdirSync(dirname(globalConfigPath)).filter((entry) =>
          entry.endsWith(".tmp")
        )
      ).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns project-layered config after saving global fixed editor state", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const projectConfigPath = join(cwd, ".pi", "pieditor.json");

    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ fixedEditor: { enabled: false, mouseScroll: false } })
    );

    try {
      const result = saveGlobalFixedEditorEnabled(true, { homeDir, cwd });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.config.fixedEditor).toEqual({
        ...DEFAULT_FIXED_EDITOR_CONFIG,
        enabled: false,
        mouseScroll: false,
      });
      expect(hasProjectFixedEditorEnabledOverride({ cwd })).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to save fixed editor state over invalid global JSON", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const globalConfigPath = join(homeDir, ".pi", "agent", "pieditor.json");

    mkdirSync(dirname(globalConfigPath), { recursive: true });
    writeFileSync(globalConfigPath, "{not-json", "utf-8");

    try {
      const result = saveGlobalFixedEditorEnabled(true, { homeDir, cwd });
      expect(result.ok).toBe(false);
      expect(readFileSync(globalConfigPath, "utf-8")).toBe("{not-json");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports invalid config files to the UI boundary", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");
    const projectConfigPath = join(cwd, ".pi", "pieditor.json");
    const errors: string[] = [];

    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(projectConfigPath, "{not-json", "utf-8");

    try {
      const config = loadConfig({
        homeDir,
        cwd,
        onConfigError: (message) => errors.push(message),
      });

      expect(config.filePicker).toEqual(DEFAULT_FILE_PICKER_CONFIG);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Invalid pieditor config");
      expect(errors[0]).toContain(projectConfigPath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("detects project fixed editor enabled overrides", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const cwd = join(tempRoot, "project");

    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "pieditor.json"),
      JSON.stringify({ fixedEditor: { enabled: false } })
    );

    try {
      expect(hasProjectFixedEditorEnabledOverride({ cwd })).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves an empty literal separator from file config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pieditor-"));
    const homeDir = join(tempRoot, "home");
    const cwd = join(tempRoot, "project");

    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "pieditor.json"),
      JSON.stringify({
        statusBar: {
          separator: "",
        },
      })
    );

    try {
      const config = loadConfig({ homeDir, cwd });
      expect(config.statusBar.separator).toBe("");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
