#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateManifest } from "./index.mjs";
export async function checkPlugin(filename) {
  const path = resolve(filename);
  if (path.endsWith(".json")) return validateManifest(JSON.parse(await readFile(path, "utf8")));
  const module = await import(pathToFileURL(path).href);
  const plugin = module.default ?? module.plugin;
  return validateManifest(plugin?.manifest);
}
export async function main(args = process.argv.slice(2)) {
  if (!args[0] || args.length > 2 || (args[1] && args[1] !== "--json")) throw new Error("Usage: margin-plugin-check <plugin.ts|manifest.json> [--json]");
  const manifest = await checkPlugin(args[0]);
  if (args[1] === "--json") console.log(JSON.stringify(manifest, null, 2));
  else console.log(`${manifest.name} is ready: ${manifest.actions.length} action(s), compatible with ${manifest.apiVersion}.`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`Plugin check failed: ${error.message}`); process.exitCode = 1; });
}
