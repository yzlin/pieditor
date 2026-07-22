import { describe, expect, it } from "bun:test";

import {
  DoubleSubmitContinue,
  matchesConfiguredSubmit,
} from "./double-enter-continue";

function harness() {
  let now = 0;
  let timeout: (() => void) | undefined;
  let changes = 0;
  const state = new DoubleSubmitContinue({
    now: () => now,
    setTimeout: (fn) => {
      timeout = fn;
      return 1 as unknown as NodeJS.Timeout;
    },
    clearTimeout: () => {
      timeout = undefined;
    },
    onArmedChange: () => {
      changes += 1;
    },
  });
  return {
    state,
    setNow: (value: number) => {
      now = value;
    },
    fireTimeout: () => timeout?.(),
    changes: () => changes,
  };
}

describe("DoubleSubmitContinue", () => {
  it("consumes the first press and continues on a second press inside 500ms", () => {
    const h = harness();
    expect(h.state.qualifyingSubmit()).toBe("consume");
    h.setNow(499);
    expect(h.state.qualifyingSubmit()).toBe("continue");
    expect(h.state.isArmed()).toBe(false);
  });

  it("treats the 500ms boundary as a new first press", () => {
    const h = harness();
    h.state.qualifyingSubmit();
    h.setNow(500);
    expect(h.state.qualifyingSubmit()).toBe("consume");
    expect(h.state.isArmed()).toBe(true);
  });

  it("disarms on timeout, non-submit input, and disposal", () => {
    const h = harness();
    h.state.qualifyingSubmit();
    h.fireTimeout();
    expect(h.state.isArmed()).toBe(false);
    expect(h.changes()).toBe(2);

    h.state.qualifyingSubmit();
    expect(h.state.nonSubmitInput()).toBe(true);
    expect(h.state.isArmed()).toBe(false);

    h.state.qualifyingSubmit();
    h.state.dispose();
    expect(h.state.isArmed()).toBe(false);
    h.fireTimeout();
    expect(h.changes()).toBe(6);
  });

  it("matches only the configured tui.input.submit binding", () => {
    const keys: string[] = [];
    const manager = {
      matches(data: string, key: string) {
        keys.push(key);
        return data === "ctrl+j" && key === "tui.input.submit";
      },
    };
    expect(matchesConfiguredSubmit(manager as never, "ctrl+j")).toBe(true);
    expect(matchesConfiguredSubmit(manager as never, "\r")).toBe(false);
    expect(keys).toEqual(["tui.input.submit", "tui.input.submit"]);
  });
});
