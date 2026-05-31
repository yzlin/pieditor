#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(scriptDir);
const debug = process.argv.includes("--debug");
const profileDir = debug ? "debug" : "release";
const crateName = "syntect_picker_preview_native";
const targetTriple = resolveTargetTriple();
const bindingName = resolveBindingName();
const sourceExtension = process.platform === "darwin" ? "dylib" : "so";
const sourceLibrary = join(
  packageDir,
  "target",
  targetTriple,
  profileDir,
  `lib${crateName}.${sourceExtension}`
);
const outputFile = join(packageDir, bindingName);

runCargoBuild(targetTriple, debug);

if (!existsSync(sourceLibrary)) {
  throw new Error(`Expected native library at ${sourceLibrary}`);
}

rmSync(outputFile, { force: true });
mkdirSync(dirname(outputFile), { recursive: true });
copyFileSync(sourceLibrary, outputFile);
console.log(`Wrote ${bindingName}`);

function runCargoBuild(target, isDebug) {
  const cargoArgs = ["build", "--target", target];
  if (!isDebug) {
    cargoArgs.push("--release");
  }

  const result = runCargoCommand(cargoArgs);

  if (result.status !== 0) {
    throw new Error(
      `${result.label} failed with code ${result.status ?? 1}`
    );
  }
}

function runCargoCommand(cargoArgs) {
  const cargo = spawnSync("cargo", cargoArgs, {
    cwd: packageDir,
    stdio: "inherit",
  });

  if (cargo.error?.code !== "ENOENT") {
    return { label: `cargo ${cargoArgs.join(" ")}`, status: cargo.status };
  }

  const rustupArgs = ["run", "stable", "cargo", ...cargoArgs];
  const rustup = spawnSync("rustup", rustupArgs, {
    cwd: packageDir,
    env: { ...process.env, ...resolveRustcEnv() },
    stdio: "inherit",
  });

  return { label: `rustup ${rustupArgs.join(" ")}`, status: rustup.status };
}

function resolveRustcEnv() {
  if (process.env.RUSTC) {
    return {};
  }

  const rustc = spawnSync("rustup", ["which", "rustc"], {
    encoding: "utf8",
  });
  if (rustc.status !== 0) {
    return {};
  }

  return { RUSTC: rustc.stdout.trim() };
}

function resolveTargetTriple() {
  switch (`${process.platform}:${process.arch}`) {
    case "darwin:arm64":
      return "aarch64-apple-darwin";
    default:
      throw new Error(
        `Unsupported build target ${process.platform}/${process.arch}; v1 native prebuilds are macOS arm64 only.`
      );
  }
}

function resolveBindingName() {
  switch (`${process.platform}:${process.arch}`) {
    case "darwin:arm64":
      return "syntect-picker-preview.darwin-arm64.node";
    default:
      throw new Error(
        `Unsupported runtime target ${process.platform}/${process.arch}; v1 native prebuilds are macOS arm64 only.`
      );
  }
}
