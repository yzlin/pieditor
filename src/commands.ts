import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

interface PieditorRuntimeHooks {
  copyEditorBuffer(ctx: ExtensionCommandContext): Promise<void>;
}

export function registerPieditorCommands(
  pi: ExtensionAPI,
  runtime: PieditorRuntimeHooks
): void {
  pi.registerCommand("copy-editor", {
    description: "Copy the active prompt editor buffer as raw text",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      runtime.copyEditorBuffer(ctx),
  });
}
