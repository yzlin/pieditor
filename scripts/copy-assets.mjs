import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const nativeSourceDir = "native/syntect-picker-preview";
const nativeOutputDir = "dist/native/syntect-picker-preview";

await mkdir("schema", { recursive: true });
await cp("configuration_schema.json", "schema/configuration_schema.json");

await mkdir(nativeOutputDir, { recursive: true });
await cp(join(nativeSourceDir, "index.js"), join(nativeOutputDir, "index.js"));
await cp(join(nativeSourceDir, "index.d.ts"), join(nativeOutputDir, "index.d.ts"));
await cp(join(nativeSourceDir, "package.json"), join(nativeOutputDir, "package.json"));

for (const entry of await readdir(nativeSourceDir)) {
  if (entry.endsWith(".node")) {
    await cp(join(nativeSourceDir, entry), join(nativeOutputDir, entry));
  }
}
