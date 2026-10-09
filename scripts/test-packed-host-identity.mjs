import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loaderArgument = process.argv[2] ?? process.env.PI_EXTENSION_LOADER;
assert(
  loaderArgument,
  "Pass the host's dist/core/extensions/loader.js path, or set PI_EXTENSION_LOADER",
);
const loaderPath = resolve(loaderArgument);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "pieditor-packed-identity-"));
const packDirectory = join(temporary, "pack");
await mkdir(packDirectory);

const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", packDirectory], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(packed.status, 0, `npm pack failed:\n${packed.stderr || packed.stdout}`);
const [{ filename }] = JSON.parse(packed.stdout);
const extracted = join(temporary, "package");
const untarred = spawnSync("tar", ["-xzf", join(packDirectory, filename), "-C", temporary], {
  encoding: "utf8",
});
assert.equal(untarred.status, 0, `tar failed:\n${untarred.stderr}`);

const manifest = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
assert.equal(manifest.main, "./src/index.ts");
assert.equal(manifest.types, "./src/index.ts");
assert.deepEqual(manifest.exports?.["."], {
  types: "./src/index.ts",
  import: "./src/index.ts",
});
assert.equal(manifest.exports?.["./schema"], "./configuration_schema.json");
assert.deepEqual(manifest.pi?.extensions, ["./src/index.ts"]);
assert.equal(manifest.pi?.configuration, "./configuration_schema.json");
for (const required of [
  "src/index.ts",
  "src/shell/scripts/bash-complete.bash",
  "src/shell/scripts/zsh-capture.zsh",
  "native/syntect-picker-preview/index.js",
  "native/syntect-picker-preview/index.d.ts",
  "native/syntect-picker-preview/package.json",
  "configuration_schema.json",
]) {
  await readFile(join(extracted, required));
}
const packedPaths = (await readdir(extracted, { recursive: true })).map(String);
for (const removedDirectory of ["dist", "types", "schema"]) {
  assert.equal(
    packedPaths.some(
      (path) => path === removedDirectory || path.startsWith(`${removedDirectory}/`),
    ),
    false,
    `packed artifact must not contain ${removedDirectory}`,
  );
}

// Supply only pieditor's ordinary runtime dependencies. Host peer packages must
// resolve through the real loader's aliases, never through the checkout.
for (const dependency of ["ignore", "@mariozechner/clipboard"]) {
  const source = join(root, "node_modules", dependency);
  const destination = join(extracted, "node_modules", dependency);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}
for (const platformDependency of [
  "clipboard-darwin-arm64",
  "clipboard-darwin-universal",
  "clipboard-linux-x64-gnu",
  "clipboard-win32-x64-msvc",
]) {
  const source = join(root, "node_modules", "@mariozechner", platformDependency);
  try {
    const destination = join(extracted, "node_modules", "@mariozechner", platformDependency);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const nativeName = `syntect-picker-preview.${process.platform}-${process.arch}.node`;
try {
  await stat(join(root, "native/syntect-picker-preview", nativeName));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (
  await stat(join(root, "native/syntect-picker-preview", nativeName)).then(
    () => true,
    () => false,
  )
) {
  await readFile(join(extracted, "native/syntect-picker-preview", nativeName));
}

const packedRequire = createRequire(join(extracted, "package.json"));
assert.throws(
  () => packedRequire.resolve("@earendil-works/pi-tui"),
  "packed dependency tree must not contain a private host TUI copy",
);

const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
const loaded = await loadExtensions([join(extracted, manifest.pi.extensions[0])], extracted);
assert.deepEqual(
  loaded.errors,
  [],
  `packed extension load errors: ${JSON.stringify(loaded.errors)}`,
);
assert.equal(loaded.extensions.length, 1);

const hostRequire = createRequire(loaderPath);
const { Editor } = await import(pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href);
let editorFactory;
const ui = {
  notify() {},
  setEditorComponent(factory) {
    editorFactory = factory;
  },
  setFooter() {},
};
const ctx = {
  cwd: extracted,
  hasUI: true,
  ui,
  isIdle: () => true,
  hasPendingMessages: () => false,
};
const handlers = loaded.extensions[0].handlers.get("session_start") ?? [];
assert.equal(handlers.length, 1);
await handlers[0]({ reason: "startup" }, ctx);
assert.equal(typeof editorFactory, "function");
const editor = editorFactory({ requestRender() {} }, {}, {});
assert.equal(
  editor instanceof Editor,
  true,
  "packed editor must share the actual host Editor identity",
);
assert.equal(editor.constructor.name, "EnhancedEditor");
console.log(`packed host identity passed: ${filename}`);
