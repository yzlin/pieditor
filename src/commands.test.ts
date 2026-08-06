import { describe, expect, it } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPieditorCommands } from "./commands";

type RegisteredCommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

describe("pieditor commands", () => {
  it("registers only copy-editor using shared runtime behavior", async () => {
    const commands = new Map<string, RegisteredCommandOptions>();
    let copyEditorCallCount = 0;
    const pi = {
      registerCommand(name: string, options: RegisteredCommandOptions) {
        commands.set(name, options);
      },
    } as ExtensionAPI;

    registerPieditorCommands(pi, {
      async copyEditorBuffer() {
        copyEditorCallCount += 1;
      },
    });

    expect([...commands.keys()]).toEqual(["copy-editor"]);
    await commands.get("copy-editor")?.handler?.("", {} as never);
    expect(copyEditorCallCount).toBe(1);
  });
});
