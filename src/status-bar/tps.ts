import type { AssistantMessage } from "@earendil-works/pi-ai";

const STREAM_DELTA_EVENTS = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

// Shorter streams (e.g. one buffered chunk) produce meaningless rates.
const MIN_SAMPLE_MS = 250;

interface MessageLike {
  role: string;
}

function isAssistantMessage(message: MessageLike): message is AssistantMessage {
  return message.role === "assistant";
}

/**
 * Measures output tokens per second for the last completed assistant message,
 * timed from the first streamed delta to message end (excludes time to first token).
 */
export class TokensPerSecondTracker {
  private firstDeltaAt: number | null = null;
  private lastTps: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  handleMessageStart(message: MessageLike): void {
    if (isAssistantMessage(message)) {
      this.firstDeltaAt = null;
    }
  }

  handleMessageUpdate(message: MessageLike, assistantMessageEvent: { type: string }): void {
    if (
      this.firstDeltaAt === null &&
      isAssistantMessage(message) &&
      STREAM_DELTA_EVENTS.has(assistantMessageEvent.type)
    ) {
      this.firstDeltaAt = this.now();
    }
  }

  handleMessageEnd(message: MessageLike): void {
    if (!isAssistantMessage(message)) {
      return;
    }

    const firstDeltaAt = this.firstDeltaAt;
    this.firstDeltaAt = null;
    if (
      firstDeltaAt === null ||
      message.stopReason === "error" ||
      message.stopReason === "aborted" ||
      !message.usage.output
    ) {
      return;
    }

    const elapsedMs = this.now() - firstDeltaAt;
    if (elapsedMs < MIN_SAMPLE_MS) {
      return;
    }
    this.lastTps = message.usage.output / (elapsedMs / 1000);
  }

  reset(): void {
    this.firstDeltaAt = null;
    this.lastTps = null;
  }

  getTokensPerSecond(): number | null {
    return this.lastTps;
  }
}
