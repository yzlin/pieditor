import { createHash } from "node:crypto";

const ESCAPE = "\x1b";
export const BRACKETED_PASTE_START = `${ESCAPE}[200~`;
export const BRACKETED_PASTE_END = `${ESCAPE}[201~`;
const TMUX_CTRL_LETTER_TAIL = /^\[(\d+);5u/;

export interface DoublePasteCandidate {
  readonly pasteFingerprint: string;
  readonly draftFingerprint: string;
  readonly armedAt: number;
}

export interface PendingDoublePasteCandidate {
  readonly pasteFingerprint: string;
  readonly observedAt: number;
}

export interface DoublePasteState {
  readonly candidate: DoublePasteCandidate | null;
  readonly pending: PendingDoublePasteCandidate | null;
}

export type DoublePasteIntent =
  | "not-paste"
  | "allow-native"
  | "consume-expand";

export interface DoublePasteInspection {
  readonly intent: DoublePasteIntent;
  readonly state: DoublePasteState;
}

export function fingerprintText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parseAndNormalizeBracketedPaste(input: string): string | null {
  if (
    !input.startsWith(BRACKETED_PASTE_START) ||
    !input.endsWith(BRACKETED_PASTE_END)
  ) {
    return null;
  }

  const pastedText = input.slice(
    BRACKETED_PASTE_START.length,
    -BRACKETED_PASTE_END.length
  );
  if (
    pastedText.includes(BRACKETED_PASTE_START) ||
    pastedText.includes(BRACKETED_PASTE_END)
  ) {
    return null;
  }

  const decodedText = pastedText
    .split(ESCAPE)
    .map((part, index) => {
      if (index === 0) {
        return part;
      }

      const match = part.match(TMUX_CTRL_LETTER_TAIL);
      const codePoint = Number(match?.[1]);
      if (
        match &&
        ((codePoint >= 97 && codePoint <= 122) ||
          (codePoint >= 65 && codePoint <= 90))
      ) {
        const controlCharacter = String.fromCharCode(
          codePoint >= 97 ? codePoint - 96 : codePoint - 64
        );
        return controlCharacter + part.slice(match[0].length);
      }
      return ESCAPE + part;
    })
    .join("");

  return decodedText
    .replace(/\r\n?|\n/g, "\n")
    .replace(/\t/g, "    ")
    .split("")
    .filter((character) => character === "\n" || character.charCodeAt(0) >= 32)
    .join("");
}

export function inspectDoublePaste(
  state: DoublePasteState,
  options: {
    input: string;
    draftText: string;
    now: number;
    windowMs: number;
  }
): DoublePasteInspection {
  const normalizedPaste = parseAndNormalizeBracketedPaste(options.input);
  if (normalizedPaste === null) {
    return { intent: "not-paste", state };
  }

  const pasteFingerprint = fingerprintText(normalizedPaste);
  const draftFingerprint = fingerprintText(options.draftText);
  const age = state.candidate
    ? options.now - state.candidate.armedAt
    : Number.POSITIVE_INFINITY;
  const candidateMatches =
    state.candidate !== null &&
    age >= 0 &&
    age <= options.windowMs &&
    state.candidate.pasteFingerprint === pasteFingerprint &&
    state.candidate.draftFingerprint === draftFingerprint;

  if (candidateMatches) {
    return {
      intent: "consume-expand",
      state: { candidate: null, pending: null },
    };
  }

  const nativeLargePaste =
    normalizedPaste.split("\n").length > 10 || normalizedPaste.length > 1000;

  return {
    intent: "allow-native",
    state: {
      candidate: null,
      pending: nativeLargePaste
        ? { pasteFingerprint, observedAt: options.now }
        : null,
    },
  };
}

export function confirmNativePaste(
  state: DoublePasteState,
  options: {
    nativeCreatedValidMarker: boolean;
    draftText: string;
  }
): DoublePasteState {
  if (!options.nativeCreatedValidMarker || state.pending === null) {
    return { candidate: null, pending: null };
  }

  return {
    candidate: {
      pasteFingerprint: state.pending.pasteFingerprint,
      draftFingerprint: fingerprintText(options.draftText),
      armedAt: state.pending.observedAt,
    },
    pending: null,
  };
}
