import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

export const DOUBLE_SUBMIT_CONTINUE_WINDOW_MS = 500;

export function matchesConfiguredSubmit(
  keybindingsManager: KeybindingsManager,
  data: string
): boolean {
  const matches = keybindingsManager.matches.bind(
    keybindingsManager
  ) as unknown as (input: string, key: string) => boolean;
  return matches(data, "tui.input.submit");
}

type Timer = ReturnType<typeof setTimeout>;

interface DoubleSubmitContinueOptions {
  onArmedChange: (armed: boolean) => void;
  now?: () => number;
  setTimeout?: (fn: () => void, delay: number) => Timer;
  clearTimeout?: (timer: Timer) => void;
}

export class DoubleSubmitContinue {
  private armedAt: number | null = null;
  private timer: Timer | null = null;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, delay: number) => Timer;
  private readonly clearScheduled: (timer: Timer) => void;

  constructor(private readonly options: DoubleSubmitContinueOptions) {
    this.now = options.now ?? Date.now;
    this.schedule = options.setTimeout ?? setTimeout;
    this.clearScheduled = options.clearTimeout ?? clearTimeout;
  }

  isArmed(): boolean {
    return this.armedAt !== null;
  }

  qualifyingSubmit(): "consume" | "continue" {
    const now = this.now();
    const shouldContinue =
      this.armedAt !== null &&
      now - this.armedAt < DOUBLE_SUBMIT_CONTINUE_WINDOW_MS;

    this.disarm();
    if (shouldContinue) {
      return "continue";
    }

    this.armedAt = now;
    this.timer = this.schedule(() => this.disarm(), DOUBLE_SUBMIT_CONTINUE_WINDOW_MS);
    this.options.onArmedChange(true);
    return "consume";
  }

  nonSubmitInput(): boolean {
    const wasArmed = this.isArmed();
    this.disarm();
    return wasArmed;
  }

  dispose(): void {
    this.disarm();
  }

  private disarm(): void {
    if (this.timer !== null) {
      this.clearScheduled(this.timer);
      this.timer = null;
    }
    if (this.armedAt === null) {
      return;
    }
    this.armedAt = null;
    this.options.onArmedChange(false);
  }
}
