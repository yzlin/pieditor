import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { EditorEnhancementsRuntimeConfig } from "./index.js";

type JsonObject = Record<string, unknown>;

/** Value written for a setting; `undefined` removes the key so lower layers/defaults apply. */
export type SettingValue = string | number | boolean | null | undefined;

interface SettingBase {
  /** Dotted path into pieditor.json. */
  id: string;
  label: string;
  description: string;
}

export type SettingDefinition =
  | (SettingBase & { kind: "boolean"; inheritable?: boolean })
  | (SettingBase & { kind: "enum"; values: readonly string[]; inheritable?: boolean })
  | (SettingBase & { kind: "string"; nullable?: boolean })
  | (SettingBase & { kind: "positiveInteger" });

/** Display value for segment options left unset, so the active preset decides. */
export const PRESET_VALUE = "preset";
/** Display value for a nullable string setting that is off. */
export const OFF_VALUE = "(off)";

const segmentOption = (id: string, label: string, description: string): SettingDefinition => ({
  id: `statusBar.segmentOptions.${id}`,
  label,
  description: `${description} "${PRESET_VALUE}" lets the status bar preset decide.`,
  kind: "boolean",
  inheritable: true,
});

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    id: "doubleSubmitMessage",
    label: "Double-submit message",
    description:
      "Message sent when submit is pressed twice on an empty editor. Empty resets to 'continue'.",
    kind: "string",
  },
  {
    id: "doubleEscapeCommand",
    label: "Double-escape command",
    description: "Extension command invoked on empty-editor double-escape. Empty turns it off.",
    kind: "string",
    nullable: true,
  },
  {
    id: "editorChrome.style",
    label: "Editor chrome",
    description: "Editor frame style.",
    kind: "enum",
    values: ["classic", "amp"],
  },
  {
    id: "doublePaste.enabled",
    label: "Double-paste expansion",
    description: "Expand a collapsed paste marker when the same paste repeats.",
    kind: "boolean",
  },
  {
    id: "doublePaste.windowMs",
    label: "Double-paste window (ms)",
    description: "Max milliseconds between the paste and its repeat. Empty resets to the default.",
    kind: "positiveInteger",
  },
  {
    id: "filePicker.respectGitignore",
    label: "File picker: respect .gitignore",
    description: "Hide gitignored files in the file picker.",
    kind: "boolean",
  },
  {
    id: "filePicker.skipHidden",
    label: "File picker: skip hidden",
    description: "Hide dotfiles in the file picker.",
    kind: "boolean",
  },
  {
    id: "filePicker.allowFolderSelection",
    label: "File picker: folder selection",
    description: "Allow selecting folders in the file picker.",
    kind: "boolean",
  },
  {
    id: "filePicker.tabCompletionMode",
    label: "File picker: tab completion",
    description: "Tab completion strategy in the file picker.",
    kind: "enum",
    values: ["bestMatch", "segment"],
  },
  {
    id: "filePicker.previewHighlightMode",
    label: "File picker: preview highlight",
    description: "Syntax highlighter for file previews.",
    kind: "enum",
    values: ["native", "builtin"],
  },
  {
    id: "statusBar.enabled",
    label: "Status bar",
    description: "Show the pieditor status bar.",
    kind: "boolean",
  },
  {
    id: "statusBar.preset",
    label: "Status bar preset",
    description: "Status bar layout preset.",
    kind: "enum",
    values: ["default", "minimal", "compact", "full", "nerd", "ascii"],
  },
  {
    id: "statusBar.separator",
    label: "Status bar separator",
    description: "Literal separator between segments. Empty resets to the preset separator.",
    kind: "string",
  },
  segmentOption("model.showThinkingLevel", "Model: thinking level", "Show thinking level."),
  {
    id: "statusBar.segmentOptions.path.mode",
    label: "Path: mode",
    description: `How the path segment renders. "${PRESET_VALUE}" lets the preset decide.`,
    kind: "enum",
    values: ["basename", "abbreviated", "full"],
    inheritable: true,
  },
  {
    id: "statusBar.segmentOptions.path.maxLength",
    label: "Path: max length",
    description: "Max path segment length. Empty lets the preset decide.",
    kind: "positiveInteger",
  },
  segmentOption("git.showBranch", "Git: branch", "Show git branch."),
  segmentOption("git.showStaged", "Git: staged", "Show staged count."),
  segmentOption("git.showUnstaged", "Git: unstaged", "Show unstaged count."),
  segmentOption("git.showUntracked", "Git: untracked", "Show untracked count."),
  {
    id: "statusBar.segmentOptions.time.format",
    label: "Time: format",
    description: `Clock format. "${PRESET_VALUE}" lets the preset decide.`,
    kind: "enum",
    values: ["12h", "24h"],
    inheritable: true,
  },
  segmentOption("time.showSeconds", "Time: seconds", "Show seconds."),
];

/** Settings that stay JSON-only in the settings UI. */
export const JSON_ONLY_SETTINGS = [
  "commandRemap",
  "filePicker.skipPatterns",
  "statusBar.leftSegments",
  "statusBar.rightSegments",
  "statusBar.colors",
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/** Returns a copy of `source` with `path` set, or removed when `value` is undefined. Empty parents are pruned. */
export function setPath(source: JsonObject, path: string, value: SettingValue): JsonObject {
  const [key, ...rest] = path.split(".");
  const next: JsonObject = { ...source };

  if (rest.length === 0) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  }

  const child = setPath(isObject(source[key]) ? source[key] : {}, rest.join("."), value);
  if (Object.keys(child).length === 0) {
    delete next[key];
  } else {
    next[key] = child;
  }
  return next;
}

/** Display string for the effective value in the settings list. */
export function formatSettingValue(
  definition: SettingDefinition,
  config: EditorEnhancementsRuntimeConfig,
): string {
  const value = getPath(config, definition.id);

  if (value === undefined || value === null) {
    if (definition.kind === "string" && definition.nullable) {
      return OFF_VALUE;
    }
    return PRESET_VALUE;
  }
  return String(value);
}

export function getSettingChoices(definition: SettingDefinition): string[] | undefined {
  switch (definition.kind) {
    case "boolean":
      return definition.inheritable ? ["true", "false", PRESET_VALUE] : ["true", "false"];
    case "enum":
      return definition.inheritable ? [...definition.values, PRESET_VALUE] : [...definition.values];
    default:
      return undefined;
  }
}

export type ParsedSettingInput = { ok: true; value: SettingValue } | { ok: false; error: string };

/** Converts a list choice or typed text into the JSON value to write. */
export function parseSettingInput(
  definition: SettingDefinition,
  input: string,
): ParsedSettingInput {
  if (input === PRESET_VALUE && "inheritable" in definition && definition.inheritable) {
    return { ok: true, value: undefined };
  }

  switch (definition.kind) {
    case "boolean":
      if (input === "true" || input === "false") {
        return { ok: true, value: input === "true" };
      }
      return { ok: false, error: `${definition.label}: expected true or false` };
    case "enum":
      if (definition.values.includes(input)) {
        return { ok: true, value: input };
      }
      return { ok: false, error: `${definition.label}: expected ${definition.values.join(", ")}` };
    case "string":
      if (!input.trim()) {
        return { ok: true, value: definition.nullable ? null : undefined };
      }
      return { ok: true, value: input };
    case "positiveInteger": {
      const trimmed = input.trim();
      if (!trimmed) {
        return { ok: true, value: undefined };
      }
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { ok: true, value: parsed };
      }
      return { ok: false, error: `${definition.label}: expected a positive integer` };
    }
  }
}

/** Reads a pieditor.json file as raw JSON. Missing file reads as `{}`. */
export function readRawConfig(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!isObject(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}

/** Sets one setting in a pieditor.json file, keeping every other key. */
export function writeSetting(path: string, settingId: string, value: SettingValue): void {
  const next = setPath(readRawConfig(path), settingId, value);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

/** True when the project config sets this key, so it wins over the global value. */
export function isProjectOverride(projectRaw: JsonObject, settingId: string): boolean {
  return getPath(projectRaw, settingId) !== undefined;
}
