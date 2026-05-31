import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_PATH = join(
  process.cwd(),
  "src",
  "shell",
  "scripts",
  "bash-complete.bash"
);

describe("bash completion script", () => {
  it("parses completion text without executing command substitutions", () => {
    const root = mkdtempSync(join(tmpdir(), "pieditor-bash-complete-"));
    const marker = join(root, "marker");

    try {
      const result = spawnSync(
        "/bin/bash",
        [SCRIPT_PATH, `echo $(touch ${marker})`, root],
        {
          encoding: "utf-8",
          timeout: 1000,
        }
      );

      expect(result.error).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
