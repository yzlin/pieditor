import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { openPieditorSettings, type PieditorSettingsHooks } from "./settings-command.js";

interface PieditorRuntimeHooks extends PieditorSettingsHooks {
  copyEditorBuffer(ctx: ExtensionCommandContext): Promise<void>;
}

export function registerPieditorCommands(pi: ExtensionAPI, runtime: PieditorRuntimeHooks): void {
  pi.registerCommand("copy-editor", {
    description: "Copy the active prompt editor buffer as raw text",
    handler: (_args: string, ctx: ExtensionCommandContext) => runtime.copyEditorBuffer(ctx),
  });

  pi.registerCommand("pieditor", {
    description: "Configure pieditor settings (saved to ~/.pi/agent/pieditor.json)",
    handler: (_args: string, ctx: ExtensionCommandContext) => openPieditorSettings(ctx, runtime),
  });
}
