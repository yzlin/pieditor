#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const supaPiDir = path.resolve(
  process.env.SUPA_PI_DIR ?? path.join(projectRoot, "..", "supa-pi"),
);
const requiredPackFiles = [
  "dist/index.js",
  "types/index.d.ts",
  "schema/configuration_schema.json",
  "native/syntect-picker-preview/index.js",
  "README.md",
  "LICENSE",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    const detail = options.capture
      ? `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      : "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${detail}`,
    );
  }

  return result.stdout;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await fileExists(path.join(supaPiDir, "extensions", "pieditor", "index.ts")))) {
    throw new Error(`supa-pi checkout not found at ${supaPiDir}`);
  }

  run("bun", ["run", "build"]);

  const packOutput = run("npm", ["pack", "--json"], { capture: true });
  const [packInfo] = JSON.parse(packOutput);
  const packedFiles = new Set(packInfo.files.map((file) => file.path));
  const missingFiles = requiredPackFiles.filter((file) => !packedFiles.has(file));

  if (missingFiles.length > 0) {
    throw new Error(`Package tarball missing files: ${missingFiles.join(", ")}`);
  }

  const tarballPath = path.join(projectRoot, packInfo.filename);
  const tempDir = await mkdtemp(path.join(tmpdir(), "pieditor-supa-pi-"));
  const tempTarballPath = path.join(tempDir, packInfo.filename);
  const packageJsonPath = path.join(supaPiDir, "package.json");
  const lockPath = path.join(supaPiDir, "bun.lock");
  const packageJsonBackupPath = path.join(tempDir, "package.json.backup");
  const lockBackupPath = path.join(tempDir, "bun.lock.backup");
  const hadLock = await fileExists(lockPath);

  await copyFile(tarballPath, tempTarballPath);
  await copyFile(packageJsonPath, packageJsonBackupPath);
  if (hadLock) {
    await copyFile(lockPath, lockBackupPath);
  }

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.dependencies = {
      ...packageJson.dependencies,
      "@yzlin/pieditor": `file:${tempTarballPath}`,
    };
    await writeFile(`${packageJsonPath}.tmp`, `${JSON.stringify(packageJson, null, 2)}\n`);
    await copyFile(`${packageJsonPath}.tmp`, packageJsonPath);
    await rm(`${packageJsonPath}.tmp`, { force: true });

    run("bun", ["install"], { cwd: supaPiDir });
    run(
      "bun",
      [
        "-e",
        "const mod = await import('./extensions/pieditor/index.ts'); if (typeof mod.default !== 'function') throw new Error('pieditor wrapper did not load default extension');",
      ],
      { cwd: supaPiDir },
    );
    run("bun", ["test", "extensions/questionnaire/index.test.ts"], {
      cwd: supaPiDir,
    });
  } finally {
    await copyFile(packageJsonBackupPath, packageJsonPath);
    if (hadLock) {
      await copyFile(lockBackupPath, lockPath);
    } else {
      await rm(lockPath, { force: true });
    }
    await rm(tarballPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
