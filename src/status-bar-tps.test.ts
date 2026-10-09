import { describe, expect, it } from "bun:test";

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { renderStatusBarLine } from "./status-bar";
import { TokensPerSecondTracker } from "./status-bar/tps";

function assistantMessage(output: number, stopReason = "stop") {
  return { role: "assistant", stopReason, usage: { output } };
}

function createTracker() {
  let now = 0;
  const tracker = new TokensPerSecondTracker(() => now);
  const advance = (ms: number) => {
    now += ms;
  };
  return { tracker, advance };
}

function streamMessage(
  tracker: TokensPerSecondTracker,
  advance: (ms: number) => void,
  options: { ttftMs: number; streamMs: number; output: number; stopReason?: string },
) {
  const message = assistantMessage(options.output, options.stopReason);
  tracker.handleMessageStart(message);
  advance(options.ttftMs);
  tracker.handleMessageUpdate(message, { type: "start" });
  tracker.handleMessageUpdate(message, { type: "text_delta" });
  advance(options.streamMs);
  tracker.handleMessageUpdate(message, { type: "text_delta" });
  tracker.handleMessageEnd(message);
}

describe("TokensPerSecondTracker", () => {
  it("measures output tokens from first delta to message end", () => {
    const { tracker, advance } = createTracker();
    streamMessage(tracker, advance, { ttftMs: 3000, streamMs: 2000, output: 100 });
    expect(tracker.getTokensPerSecond()).toBe(50);
  });

  it("keeps the previous rate for aborted, errored, or too-short messages", () => {
    const { tracker, advance } = createTracker();
    streamMessage(tracker, advance, { ttftMs: 0, streamMs: 1000, output: 40 });
    streamMessage(tracker, advance, {
      ttftMs: 0,
      streamMs: 1000,
      output: 500,
      stopReason: "aborted",
    });
    streamMessage(tracker, advance, {
      ttftMs: 0,
      streamMs: 1000,
      output: 500,
      stopReason: "error",
    });
    streamMessage(tracker, advance, { ttftMs: 0, streamMs: 10, output: 500 });
    expect(tracker.getTokensPerSecond()).toBe(40);
  });

  it("ignores non-assistant messages and clears on reset", () => {
    const { tracker, advance } = createTracker();
    streamMessage(tracker, advance, { ttftMs: 0, streamMs: 1000, output: 40 });
    tracker.handleMessageEnd({ role: "user" });
    expect(tracker.getTokensPerSecond()).toBe(40);
    tracker.reset();
    expect(tracker.getTokensPerSecond()).toBeNull();
  });
});

describe("tps status bar segment", () => {
  const ctx = {
    model: { id: "test-model", name: "test-model", contextWindow: 200_000 },
    modelRegistry: {},
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "session-12345678",
    },
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;
  const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;

  function render(tokensPerSecond: number | null, width = 120) {
    return renderStatusBarLine({
      width,
      ctx,
      footerData: null,
      config: {
        enabled: true,
        preset: "default",
        leftSegments: ["model"],
        rightSegments: ["tps"],
      },
      sessionStartTime: Date.now(),
      theme,
      tokensPerSecond,
    });
  }

  it("renders the rate and hides when unknown", () => {
    expect(render(42.4)).toContain("42 tok/s");
    expect(render(7.25)).toContain("7.3 tok/s");
    expect(render(null)).not.toContain("tok/s");
  });

  it("uses compact output when narrow", () => {
    const line = render(42.4, 24);
    expect(line).toContain("42t/s");
  });
});
