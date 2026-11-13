import {
  type ExtensionCommandContext,
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Input,
  type SettingItem,
  SettingsList,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

import {
  type EditorEnhancementsRuntimeConfig,
  getGlobalPieditorConfigPath,
  getProjectPieditorConfigPath,
  loadConfig,
} from "./config/index.js";
import {
  formatSettingValue,
  getSettingChoices,
  isProjectOverride,
  JSON_ONLY_SETTINGS,
  OFF_VALUE,
  parseSettingInput,
  PRESET_VALUE,
  readRawConfig,
  SETTING_DEFINITIONS,
  type SettingDefinition,
  writeSetting,
} from "./config/settings.js";

export interface PieditorSettingsHooks {
  reloadConfig(ctx: ExtensionCommandContext): void;
}

function createTextSubmenu(
  theme: Theme,
  definition: SettingDefinition,
  currentValue: string,
  done: (value?: string) => void,
): Component {
  const input = new Input();
  const initial = currentValue === OFF_VALUE || currentValue === PRESET_VALUE ? "" : currentValue;
  // Insert as a bracketed paste so the cursor ends after the prefilled text (setValue keeps it at 0).
  input.handleInput(`\u001b[200~${initial}\u001b[201~`);
  input.onSubmit = (value) => done(value);
  input.onEscape = () => done();

  const container = new Container();
  container.addChild(new Text(theme.fg("accent", definition.label), 0, 0));
  container.addChild(new Text(theme.fg("muted", definition.description), 0, 0));
  container.addChild(input);
  container.addChild(new Text(theme.fg("dim", "enter save · esc cancel"), 0, 0));

  return {
    render: (width) => container.render(width),
    invalidate: () => container.invalidate(),
    handleInput: (data) => input.handleInput(data),
  };
}

function hasProjectOverride(projectPath: string, id: string): boolean {
  try {
    return isProjectOverride(readRawConfig(projectPath), id);
  } catch {
    // loadConfig already reports an invalid project file.
    return false;
  }
}

export async function openPieditorSettings(
  ctx: ExtensionCommandContext,
  hooks: PieditorSettingsHooks,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/pieditor requires TUI mode", "error");
    return;
  }

  const globalPath = getGlobalPieditorConfigPath();
  const projectPath = getProjectPieditorConfigPath(ctx.cwd);

  try {
    readRawConfig(globalPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`pieditor: cannot edit ${globalPath}: ${message}`, "error");
    return;
  }

  const load = (): EditorEnhancementsRuntimeConfig => loadConfig({ cwd: ctx.cwd });
  let config = load();

  await ctx.ui.custom<void>((tui: TUI, theme: Theme, _keybindings, done) => {
    const items: SettingItem[] = SETTING_DEFINITIONS.map((definition) => {
      const choices = getSettingChoices(definition);
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        currentValue: formatSettingValue(definition, config),
        ...(choices
          ? { values: choices }
          : {
              submenu: (currentValue: string, submenuDone: (value?: string) => void) =>
                createTextSubmenu(theme, definition, currentValue, submenuDone),
            }),
      };
    });

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 16),
      getSettingsListTheme(),
      (id, input) => {
        const definition = SETTING_DEFINITIONS.find((entry) => entry.id === id);
        if (!definition) {
          return;
        }

        const parsed = parseSettingInput(definition, input);
        if (!parsed.ok) {
          ctx.ui.notify(parsed.error, "error");
        } else {
          try {
            writeSetting(globalPath, id, parsed.value);
            hooks.reloadConfig(ctx);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`pieditor: failed to save ${id}: ${message}`, "error");
          }
          if (hasProjectOverride(projectPath, id)) {
            ctx.ui.notify(
              `pieditor: ${projectPath} also sets ${id}; the project value wins`,
              "warning",
            );
          }
        }

        // Show the effective value, which may differ from the input (fallbacks, project overrides).
        config = load();
        for (const entry of SETTING_DEFINITIONS) {
          settingsList.updateValue(entry.id, formatSettingValue(entry, config));
        }
        tui.requestRender();
      },
      () => done(undefined),
      { enableSearch: true },
    );

    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("pieditor settings")), 0, 0));
    container.addChild(new Text(theme.fg("dim", `Saves to ${globalPath}`), 0, 0));
    container.addChild(settingsList);
    container.addChild(
      new Text(theme.fg("dim", `Edit in JSON only: ${JSON_ONLY_SETTINGS.join(", ")}`), 0, 0),
    );

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
