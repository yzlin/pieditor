import {
  ExtensionSelectorComponent,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

import {
  acquireAboveEditorSurfaceLease,
  requestAboveEditorSurfaceRender,
} from "./above-editor-lease.js";

interface PromptOptions {
  timeout?: number;
  signal?: AbortSignal;
}

interface SelectPrompt {
  title: string;
  options: string[];
  opts?: PromptOptions;
  removeQueuedAbortListener?: () => void;
  resolve(value: string | undefined): void;
}

const MAX_OPTION_ROWS = 8;

function windowLinesAroundIndex(
  lines: string[],
  index: number,
  maxRows: number
): string[] {
  if (lines.length <= maxRows) {
    return lines;
  }

  const start = Math.max(0, Math.min(index, lines.length - maxRows));
  return lines.slice(start, start + maxRows);
}

class FixedSelectSurface {
  selected = 0;
  scrollTop = 0;

  constructor(
    private readonly title: string,
    private readonly options: string[]
  ) {}

  move(delta: number): void {
    if (this.options.length === 0) {
      return;
    }

    this.selected = Math.max(
      0,
      Math.min(this.options.length - 1, this.selected + delta)
    );
    this.ensureSelectedVisible();
  }

  render(width: number, maxRows = Number.POSITIVE_INFINITY): string[] {
    const maxOptionRows = Math.min(
      MAX_OPTION_ROWS,
      Math.max(1, this.options.length)
    );

    for (let optionRows = maxOptionRows; optionRows > 0; optionRows -= 1) {
      const lines = this.renderWithOptionRows(width, optionRows);
      if (lines.length <= maxRows || optionRows === 1) {
        const selectedLine = lines.findIndex((line) => line.includes("→"));
        return selectedLine === -1
          ? lines.slice(0, maxRows)
          : windowLinesAroundIndex(lines, selectedLine, maxRows);
      }
    }

    return [];
  }

  private renderWithOptionRows(width: number, optionRows: number): string[] {
    this.ensureSelectedVisible(optionRows);
    const visible = this.options.slice(this.scrollTop, this.scrollTop + optionRows);
    const selectedIndex = Math.max(0, this.selected - this.scrollTop);
    const selector = new ExtensionSelectorComponent(
      this.title,
      visible,
      () => undefined,
      () => undefined
    );
    Reflect.set(selector, "selectedIndex", selectedIndex);
    const updateList = Reflect.get(selector, "updateList");
    if (typeof updateList === "function") {
      updateList.call(selector);
    }
    return selector.render(width);
  }

  private ensureSelectedVisible(rows = MAX_OPTION_ROWS): void {
    if (this.selected < this.scrollTop) {
      this.scrollTop = this.selected;
    }

    if (this.selected >= this.scrollTop + rows) {
      this.scrollTop = this.selected - rows + 1;
    }
  }
}

export class FixedSelectConfirmShim {
  private queue: SelectPrompt[] = [];
  private active = false;
  private cancelActivePrompt: (() => void) | undefined;

  constructor(
    private readonly ui: ExtensionUIContext,
    private readonly isFixedCompositorInstalled: () => boolean,
    private readonly originalSelect: ExtensionUIContext["select"],
    private readonly originalConfirm: ExtensionUIContext["confirm"]
  ) {}

  select: ExtensionUIContext["select"] = (title, options, opts) => {
    if (!this.isFixedCompositorInstalled()) {
      return this.originalSelect.call(this.ui, title, options, opts);
    }

    if (opts?.signal?.aborted) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      const prompt: SelectPrompt = { title, options, opts, resolve };
      const abortQueuedPrompt = () => {
        const index = this.queue.indexOf(prompt);
        if (index === -1) {
          return;
        }
        this.queue.splice(index, 1);
        prompt.removeQueuedAbortListener?.();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", abortQueuedPrompt, { once: true });
      prompt.removeQueuedAbortListener = () =>
        opts?.signal?.removeEventListener("abort", abortQueuedPrompt);
      this.queue.push(prompt);
      void this.drain();
    });
  };

  confirm: ExtensionUIContext["confirm"] = async (title, message, opts) => {
    if (!this.isFixedCompositorInstalled()) {
      return this.originalConfirm.call(this.ui, title, message, opts);
    }

    return (await this.select(`${title}\n${message}`, ["Yes", "No"], opts)) === "Yes";
  };

  cancelPendingPrompts(): void {
    for (const prompt of this.queue.splice(0)) {
      prompt.removeQueuedAbortListener?.();
      prompt.resolve(undefined);
    }
    this.cancelActivePrompt?.();
  }

  private async drain(): Promise<void> {
    if (this.active) {
      return;
    }

    this.active = true;
    while (this.queue.length > 0) {
      const prompt = this.queue.shift();
      if (!prompt) {
        continue;
      }
      await this.runPrompt(prompt);
    }
    this.active = false;
  }

  private runPrompt(prompt: SelectPrompt): Promise<void> {
    return new Promise((done) => {
      prompt.removeQueuedAbortListener?.();
      prompt.removeQueuedAbortListener = undefined;

      if (prompt.opts?.signal?.aborted || !this.isFixedCompositorInstalled()) {
        prompt.resolve(undefined);
        done();
        return;
      }

      const surface = new FixedSelectSurface(prompt.title, prompt.options);
      let settled = false;
      let unsubscribe: (() => void) | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const lease = acquireAboveEditorSurfaceLease({
        owner: "pieditor",
        id: "select-confirm",
        target: surface,
      });

      const finish = (value: string | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        this.cancelActivePrompt = undefined;
        unsubscribe?.();
        if (timeout) {
          clearTimeout(timeout);
        }
        prompt.opts?.signal?.removeEventListener("abort", abort);
        lease.release();
        prompt.resolve(value);
        done();
      };

      const abort = () => finish(undefined);
      this.cancelActivePrompt = abort;

      prompt.opts?.signal?.addEventListener("abort", abort, { once: true });
      if (prompt.opts?.timeout !== undefined) {
        timeout = setTimeout(() => finish(undefined), prompt.opts.timeout);
      }

      unsubscribe = this.ui.onTerminalInput((data) => {
        if (!this.isFixedCompositorInstalled()) {
          finish(undefined);
          return undefined;
        }

        const keybindings = getKeybindings();
        if (keybindings.matches(data, "tui.select.cancel")) {
          finish(undefined);
          return { consume: true };
        }
        if (keybindings.matches(data, "tui.select.confirm")) {
          finish(prompt.options[surface.selected]);
          return { consume: true };
        }
        if (keybindings.matches(data, "tui.select.up") || data === "k") {
          surface.move(-1);
          requestAboveEditorSurfaceRender();
          return { consume: true };
        }
        if (keybindings.matches(data, "tui.select.down") || data === "j") {
          surface.move(1);
          requestAboveEditorSurfaceRender();
          return { consume: true };
        }
        return { consume: true };
      });
    });
  }
}

