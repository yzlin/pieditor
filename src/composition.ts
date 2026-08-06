import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { loadConfig } from "./config.js";
import { EnhancedEditor } from "./enhanced-editor.js";
import { warmPreviewHighlighter } from "./file-picker-highlight.js";
import { invalidateGitBranch, invalidateGitStatus } from "./status-bar-git.js";

type CopyText = (text: string) => Promise<void> | void;

interface PieditorCompositionOptions {
  copyText?: CopyText;
}

interface PieditorRuntime {
  activeContext: ExtensionContext | null;
  activeEditor: EnhancedEditor | null;
  activeEditorTui: TUI | null;
  activeFooterData: ReadonlyFooterDataProvider | null;
}

const GIT_BRANCH_PATTERNS = [
  /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
  /\bgit\s+stash\s+(pop|apply)/,
];

function getDoubleEscapeCommandState(
  pi: ExtensionAPI,
  doubleEscapeCommand: string | null
): { command: string | null; isVisible: boolean } {
  if (!doubleEscapeCommand) {
    return { command: null, isVisible: false };
  }

  return {
    command: doubleEscapeCommand,
    isVisible: pi
      .getCommands()
      .some((command) => command.name === doubleEscapeCommand),
  };
}

function mightChangeGitBranch(command: string): boolean {
  return GIT_BRANCH_PATTERNS.some((pattern) => pattern.test(command));
}

function invalidateGitState(): void {
  invalidateGitStatus();
  invalidateGitBranch();
}

export function createPieditorComposition(
  pi: ExtensionAPI,
  options: PieditorCompositionOptions = {}
) {
  const runtime: PieditorRuntime = {
    activeContext: null,
    activeEditor: null,
    activeEditorTui: null,
    activeFooterData: null,
  };

  function getCopyText(): CopyText {
    return options.copyText ?? copyToClipboard;
  }

  return {
    attachEditor(ctx: ExtensionContext): void {
      if (!ctx.hasUI) {
        return;
      }

      runtime.activeContext = ctx;
      const config = loadConfig({
        onConfigError: (message) => ctx.ui.notify(message, "error"),
      });
      let warnedMissingDoubleEscapeCommand = false;

      const getDoubleEscapeCommand = () => {
        const commandState = getDoubleEscapeCommandState(
          pi,
          config.doubleEscapeCommand
        );

        if (
          commandState.command &&
          !commandState.isVisible &&
          !warnedMissingDoubleEscapeCommand
        ) {
          ctx.ui.notify(
            `pieditor: '/${commandState.command}' is not currently visible in slash commands; submitting it anyway`,
            "warning"
          );
        }

        warnedMissingDoubleEscapeCommand = Boolean(
          commandState.command && !commandState.isVisible
        );
        return commandState.command;
      };

      ctx.ui.setEditorComponent(
        (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
          runtime.activeEditorTui = tui;
          runtime.activeEditor = new EnhancedEditor(
            tui,
            theme,
            keybindings,
            ctx.ui,
            {
              onContinue: () => {
                if (runtime.activeContext?.isIdle()) {
                  pi.sendUserMessage("continue");
                } else {
                  pi.sendUserMessage("continue", { deliverAs: "followUp" });
                }
              },
              getDoubleEscapeCommand,
              canTriggerDoubleEscapeCommand: () =>
                Boolean(
                  runtime.activeContext?.isIdle() &&
                    !runtime.activeContext.hasPendingMessages()
                ),
              commandRemap: config.commandRemap,
              doublePaste: config.doublePaste,
              editorChrome: config.editorChrome,
              statusBar: {
                config: config.statusBar,
                getContext: () => runtime.activeContext,
                getFooterData: () => runtime.activeFooterData,
              },
            }
          );
          return runtime.activeEditor;
        }
      );

      ctx.ui.setFooter(
        (tui: TUI, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
          runtime.activeFooterData = footerData;
          const unsub = footerData.onBranchChange(() => tui.requestRender());
          return {
            dispose() {
              unsub();
              if (runtime.activeFooterData === footerData) {
                runtime.activeFooterData = null;
              }
            },
            invalidate() {
              // Footer data is pulled during EnhancedEditor.render().
            },
            render(): string[] {
              return [];
            },
          };
        }
      );

      setTimeout(() => {
        warmPreviewHighlighter(config.filePicker.previewHighlightMode);
      }, 0);
    },

    detachEditor(): void {
      runtime.activeEditor?.dispose();
      runtime.activeContext = null;
      runtime.activeEditor = null;
      runtime.activeEditorTui = null;
      runtime.activeFooterData = null;
    },

    handleToolResult(event: {
      toolName: string;
      input?: { command?: unknown };
    }): void {
      if (event.toolName === "write" || event.toolName === "edit") {
        invalidateGitStatus();
      }
      if (event.toolName === "bash" && event.input?.command) {
        const command = String(event.input.command);
        if (mightChangeGitBranch(command)) {
          invalidateGitState();
        }
      }
    },

    handleUserBash(command: string): void {
      if (mightChangeGitBranch(command)) {
        invalidateGitState();
      }
    },

    async pasteClipboardRaw(ctx: ExtensionContext): Promise<void> {
      if (!ctx.hasUI) {
        return;
      }
      if (!runtime.activeEditor) {
        ctx.ui.notify("Editor not ready", "warning");
        return;
      }
      await runtime.activeEditor.pasteClipboardRawAtCursor();
    },

    async copyEditorBuffer(ctx: ExtensionContext): Promise<void> {
      if (
        !ctx.hasUI ||
        !runtime.activeEditor ||
        runtime.activeEditorTui?.hasOverlay?.()
      ) {
        ctx.ui.notify("Editor not ready", "warning");
        return;
      }

      const text = runtime.activeEditor.getText();
      if (text.length === 0) {
        ctx.ui.notify("Editor buffer empty", "info");
        return;
      }

      try {
        await getCopyText()(text);
        ctx.ui.notify(`Copied ${text.length} characters from editor`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Editor copy failed: ${message}`, "warning");
      }
    },
  };
}
