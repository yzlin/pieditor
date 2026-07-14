import { describe, expect, it } from "bun:test";

import {
  confirmNativePaste,
  type DoublePasteState,
  fingerprintText,
  inspectDoublePaste,
  parseAndNormalizeBracketedPaste,
} from "./double-paste.js";

const START = "\x1b[200~";
const END = "\x1b[201~";
const EMPTY_STATE: DoublePasteState = { candidate: null, pending: null };
const LARGE_PASTE = Array.from(
  { length: 11 },
  (_, index) => `line-${index}`
).join("\n");

describe("parseAndNormalizeBracketedPaste", () => {
  it("accepts only one complete bracketed-paste envelope", () => {
    expect(parseAndNormalizeBracketedPaste(`${START}hello${END}`)).toBe("hello");
    expect(parseAndNormalizeBracketedPaste(`${START}${END}`)).toBe("");
    expect(parseAndNormalizeBracketedPaste("hello")).toBeNull();
    expect(parseAndNormalizeBracketedPaste(`${START}partial`)).toBeNull();
    expect(parseAndNormalizeBracketedPaste(`prefix${START}hello${END}`)).toBeNull();
    expect(parseAndNormalizeBracketedPaste(`${START}hello${END}suffix`)).toBeNull();
    expect(
      parseAndNormalizeBracketedPaste(`${START}one${END}${START}two${END}`)
    ).toBeNull();
  });

  it("matches Pi native paste normalization while preserving Unicode", () => {
    const pasted =
      "a\r\nb\rc\td\x00\x07" +
      "\x1b[106;5u" +
      "\x1b[77;5u" +
      "\x1b[49;5u" +
      " café 😀";

    expect(parseAndNormalizeBracketedPaste(`${START}${pasted}${END}`)).toBe(
      "a\nb\nc    d\n\n[49;5u café 😀"
    );
  });
});

describe("double-paste candidate state", () => {
  it("arms only after native handling confirms a new valid marker", () => {
    const inspected = inspectDoublePaste(EMPTY_STATE, {
      input: `${START}${LARGE_PASTE}${END}`,
      draftText: "before",
      now: 100,
      windowMs: 500,
    });

    expect(inspected.intent).toBe("allow-native");
    expect(inspected.state.candidate).toBeNull();

    const rejected = confirmNativePaste(inspected.state, {
      nativeCreatedValidMarker: false,
      draftText: "beforelarge paste",
    });
    expect(rejected).toEqual(EMPTY_STATE);

    const armed = confirmNativePaste(inspected.state, {
      nativeCreatedValidMarker: true,
      draftText: "before[paste #1 +20 lines]",
    });
    expect(armed.candidate).toEqual({
      pasteFingerprint: fingerprintText(LARGE_PASTE),
      draftFingerprint: fingerprintText("before[paste #1 +20 lines]"),
      armedAt: 100,
    });
    expect(armed.pending).toBeNull();
    expect(JSON.stringify(armed)).not.toContain("large paste");
    expect(JSON.stringify(armed)).not.toContain("before[paste");
  });

  it("reports consume/expand for an exact timely repeat with unchanged draft", () => {
    const first = inspectDoublePaste(EMPTY_STATE, {
      input: `${START}${LARGE_PASTE}${END}`,
      draftText: "",
      now: 1_000,
      windowMs: 500,
    });
    const armed = confirmNativePaste(first.state, {
      nativeCreatedValidMarker: true,
      draftText: "[paste #1 +12 lines]",
    });

    const repeated = inspectDoublePaste(armed, {
      input: `${START}${LARGE_PASTE}${END}`,
      draftText: "[paste #1 +12 lines]",
      now: 1_500,
      windowMs: 500,
    });

    expect(repeated.intent).toBe("consume-expand");
    expect(repeated.state).toEqual(EMPTY_STATE);
  });

  it("expires candidates and makes a candidate ineligible after a draft edit", () => {
    const candidate = {
      pasteFingerprint: fingerprintText("same"),
      draftFingerprint: fingerprintText("marker"),
      armedAt: 10,
    };

    const expired = inspectDoublePaste(
      { candidate, pending: null },
      {
        input: `${START}same${END}`,
        draftText: "marker",
        now: 111,
        windowMs: 100,
      }
    );
    expect(expired.intent).toBe("allow-native");
    expect(expired.state.candidate).toBeNull();

    const edited = inspectDoublePaste(
      { candidate, pending: null },
      {
        input: `${START}${LARGE_PASTE}${END}`,
        draftText: "marker edited",
        now: 50,
        windowMs: 100,
      }
    );
    expect(edited.intent).toBe("allow-native");
    expect(edited.state.candidate).toBeNull();
    expect(edited.state.pending?.pasteFingerprint).toBe(
      fingerprintText(LARGE_PASTE)
    );
  });

  it("rolls a mismatch forward only when it creates a valid marker", () => {
    const oldCandidate = {
      pasteFingerprint: fingerprintText("old"),
      draftFingerprint: fingerprintText("old marker"),
      armedAt: 10,
    };
    const mismatch = inspectDoublePaste(
      { candidate: oldCandidate, pending: null },
      {
        input: `${START}${LARGE_PASTE}${END}`,
        draftText: "old marker",
        now: 20,
        windowMs: 100,
      }
    );

    expect(mismatch.intent).toBe("allow-native");
    expect(mismatch.state.candidate).toBeNull();

    const rolled = confirmNativePaste(mismatch.state, {
      nativeCreatedValidMarker: true,
      draftText: "old marker[new marker]",
    });
    expect(rolled.candidate).toEqual({
      pasteFingerprint: fingerprintText(LARGE_PASTE),
      draftFingerprint: fingerprintText("old marker[new marker]"),
      armedAt: 20,
    });

    expect(
      confirmNativePaste(mismatch.state, {
        nativeCreatedValidMarker: false,
        draftText: "old markernew",
      })
    ).toEqual(EMPTY_STATE);
  });

  it("ignores non-envelopes without disturbing state", () => {
    const state: DoublePasteState = {
      candidate: {
        pasteFingerprint: fingerprintText("old"),
        draftFingerprint: fingerprintText("marker"),
        armedAt: 10,
      },
      pending: null,
    };

    const result = inspectDoublePaste(state, {
      input: "ordinary input",
      draftText: "marker",
      now: 20,
      windowMs: 100,
    });
    expect(result).toEqual({ intent: "not-paste", state });
  });
});
