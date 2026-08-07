import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURSOR_MARKER } from "@earendil-works/pi-tui";

import { FileBrowserComponent } from "./file-picker";

type FileBrowserInternals = {
  selected: number;
  focusOnOptions: boolean;
  selectedOption: number;
};

function internals(browser: FileBrowserComponent): FileBrowserInternals {
  return browser as unknown as FileBrowserInternals;
}

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-file-picker-keys-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("file picker keybindings", () => {
  it("propagates overlay focus to the search input", () => {
    const root = createTempDir();
    writeFileSync(join(root, "alpha.txt"), "alpha", "utf8");
    process.chdir(root);

    const browser = new FileBrowserComponent(() => {
      /* noop */
    });

    browser.focused = false;
    expect(browser.render(120).join("\n")).not.toContain(CURSOR_MARKER);

    browser.focused = true;
    expect(browser.render(120).join("\n")).toContain(CURSOR_MARKER);

    browser.handleInput("\u001b[Z");
    expect(browser.render(120).join("\n")).not.toContain(CURSOR_MARKER);

    browser.focused = false;
    browser.handleInput("\u001b");
    expect(browser.render(120).join("\n")).not.toContain(CURSOR_MARKER);
  });

  it("treats ctrl+n like down in the browser list", () => {
    const root = createTempDir();
    writeFileSync(join(root, "alpha.txt"), "alpha", "utf8");
    writeFileSync(join(root, "beta.txt"), "beta", "utf8");
    process.chdir(root);

    const downBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    downBrowser.handleInput("\u001b[B");

    const ctrlNBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    ctrlNBrowser.handleInput("\x0e");

    expect(internals(downBrowser).selected).toBe(1);
    expect(internals(ctrlNBrowser).selected).toBe(internals(downBrowser).selected);
  });

  it("treats ctrl+p like up in the browser list", () => {
    const root = createTempDir();
    writeFileSync(join(root, "alpha.txt"), "alpha", "utf8");
    writeFileSync(join(root, "beta.txt"), "beta", "utf8");
    process.chdir(root);

    const upBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    upBrowser.handleInput("\u001b[A");

    const ctrlPBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    ctrlPBrowser.handleInput("\x10");

    expect(internals(upBrowser).selected).toBeGreaterThan(0);
    expect(internals(ctrlPBrowser).selected).toBe(internals(upBrowser).selected);
  });

  it("treats ctrl+n and ctrl+p like down and up in the options panel", () => {
    const root = createTempDir();
    writeFileSync(join(root, "alpha.txt"), "alpha", "utf8");
    process.chdir(root);

    const downBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    downBrowser.handleInput("\u001b[Z");
    downBrowser.handleInput("\u001b[B");

    const ctrlNBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    ctrlNBrowser.handleInput("\u001b[Z");
    ctrlNBrowser.handleInput("\x0e");

    expect(internals(downBrowser).focusOnOptions).toBe(true);
    expect(internals(ctrlNBrowser).focusOnOptions).toBe(true);
    expect(internals(ctrlNBrowser).selectedOption).toBe(
      internals(downBrowser).selectedOption
    );

    const upBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    upBrowser.handleInput("\u001b[Z");
    upBrowser.handleInput("\u001b[A");

    const ctrlPBrowser = new FileBrowserComponent(() => {
      /* noop */
    });
    ctrlPBrowser.handleInput("\u001b[Z");
    ctrlPBrowser.handleInput("\x10");

    expect(internals(ctrlPBrowser).selectedOption).toBe(
      internals(upBrowser).selectedOption
    );
  });
});
