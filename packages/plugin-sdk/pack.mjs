#!/usr/bin/env node
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkPlugin } from "./check.mjs";
import { safePath, rejectSecretPath, writePackage } from "./archive.mjs";
const hostTarget = { os: process.platform, arch: process.arch === "x64" ? "amd64" : process.arch };
function parse(args) {
  const values = {};
  let source;
  while (args.length) {
    const value = args.shift();
    if (!value.startsWith("--") && !source) { source = value; continue; }
    if (!["--entry", "--runtime", "--runtime-license", "--output", "--directory", "--manifest", "--executable", "--args", "--os", "--arch"].includes(value) || !args.length) throw new Error("Usage: margin-plugin-pack plugin.ts [--entry server.ts] [--runtime /path/to/node] [--runtime-license /path/to/LICENSE] [--output plugin.margin-plugin] OR --directory payload --manifest manifest.json --executable runtime/app [--args '[\"app/file\"]'] [--os linux|darwin --arch amd64|arm64]");
    if (Object.hasOwn(values, value.slice(2))) throw new Error(`Duplicate option ${value}.`);
    values[value.slice(2)] = args.shift();
  }
  return { ...values, source };
}
function target(options) {
  const result = { os: options.os ?? hostTarget.os, arch: options.arch ?? hostTarget.arch };
  if (!["linux", "darwin"].includes(result.os) || !["amd64", "arm64"].includes(result.arch)) throw new Error("Target must be linux/darwin and amd64/arm64.");
  return result;
}
async function addTree(entries, root, path, prefix = "") {
  safePath(path); rejectSecretPath(path);
  const source = join(root, path);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not package payloads: ${path}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(source)).sort()) await addTree(entries, root, `${path}/${name}`, prefix);
  } else if (info.isFile()) entries.push({ path: prefix + path, source });
  else throw new Error(`Only regular files are supported: ${path}`);
  if (entries.length > 19999) throw new Error("Package exceeds 20000 files.");
}
async function runtimeTarget(path) {
  const bytes = await readFile(path);
  if (bytes.length < 32) throw new Error("Node runtime is not a supported native binary.");
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[5] === 1) {
    const arch = { 62: "amd64", 183: "arm64" }[bytes.readUInt16LE(18)];
    if (arch) return { os: "linux", arch };
  }
  if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    const arch = { 0x01000007: "amd64", 0x0100000c: "arm64" }[bytes.readUInt32LE(4)];
    if (arch) return { os: "darwin", arch };
  }
  throw new Error("Use a native Linux ELF or macOS Mach-O Node runtime for amd64/arm64 (universal/fat binaries unsupported).");
}
async function nodePayload(options, selected) {
  const root = process.cwd();
  const source = options.source ?? "plugin.ts";
  const entry = options.entry ?? "server.ts";
  safePath(source); safePath(entry);
  const plugin = await checkPlugin(source);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const extraDependencies = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "@margin/plugin-sdk");
  if (extraDependencies.length) throw new Error("For extra production dependencies, build a complete payload and use --directory; automatic node_modules copying is intentionally unsupported.");
  const include = pkg.margin?.files ?? [source, entry];
  if (!Array.isArray(include) || include.some((path) => typeof path !== "string") || !include.includes(source) || !include.includes(entry)) throw new Error("package.json margin.files must be an array of paths including the plugin source and server entry.");
  const entries = [];
  for (const path of include) {
    if (path === "node_modules" || path.startsWith("node_modules/") || path === "package.json") throw new Error("margin.files lists app source/assets; SDK and package.json are added automatically.");
    await addTree(entries, root, path, "app/");
  }
  const runtime = await realpath(resolve(options.runtime ?? process.execPath));
  const actual = await runtimeTarget(runtime);
  if (actual.os !== selected.os || actual.arch !== selected.arch) throw new Error(`Runtime is ${actual.os}/${actual.arch}, not requested ${selected.os}/${selected.arch}. Supply the matching --runtime binary.`);
  if (actual.os === hostTarget.os && actual.arch === hostTarget.arch) {
    const version = spawnSync(runtime, ["--version"], { encoding: "utf8", timeout: 5000, env: {} });
    if (version.status !== 0 || !/^v(2[4-9]|[3-9]\d)\./.test(version.stdout.trim())) throw new Error("The bundled runtime must be Node.js 24 or later.");
  }
  entries.push({ path: "runtime/node", source: runtime });
  let license;
  for (const candidate of options["runtime-license"] ? [resolve(options["runtime-license"])] : [join(dirname(runtime), "../LICENSE"), join(dirname(runtime), "LICENSE")]) {
    try { if ((await lstat(candidate)).isFile()) { license = candidate; break; } } catch { /* Try the next distribution location. */ }
  }
  if (!license) throw new Error("Keep Node's distribution LICENSE with its binary or pass --runtime-license /path/to/LICENSE.");
  entries.push({ path: "runtime/LICENSE", source: license });
  entries.push({ path: "app/package.json", bytes: Buffer.from(JSON.stringify({ type: "module", private: true })) });
  // Resolve the SDK explicitly; local npm development symlinks never enter the ZIP.
  const installed = await realpath(join(root, "node_modules/@margin/plugin-sdk"));
  const sdk = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  if (sdk.name !== "@margin/plugin-sdk") throw new Error("Expected the local @margin/plugin-sdk dependency.");
  for (const path of ["index.mjs", "schema.mjs", "server.mjs", "index.d.mts", "browser.mjs", "browser.d.mts", "package.json"]) await addTree(entries, installed, path, "app/node_modules/@margin/plugin-sdk/");
  return { plugin, entries, launch: { executable: "runtime/node", args: [`app/${entry}`] } };
}
async function directoryPayload(options) {
  if (!options.manifest || !options.executable || options.source || options.entry || options.runtime || options["runtime-license"]) throw new Error("Directory mode needs --manifest and --executable, without Node source/entry/runtime options.");
  const plugin = await checkPlugin(options.manifest);
  const entries = [];
  const root = await realpath(resolve(options.directory));
  for (const path of (await readdir(root)).sort()) await addTree(entries, root, path);
  const executable = safePath(options.executable);
  if (!entries.some((entry) => entry.path === executable)) throw new Error("Launch executable must be a regular payload file.");
  const args = JSON.parse(options.args ?? "[]");
  if (!Array.isArray(args) || args.length > 128 || args.some((arg) => typeof arg !== "string" || Buffer.byteLength(arg) > 4096 || arg.includes("\0"))) throw new Error("--args must be a JSON array of up to 128 strings (4096 bytes each).");
  return { plugin, entries, launch: { executable, args } };
}
export async function pack(args) {
  const options = parse([...args]);
  if (!options.directory && (options.manifest || options.executable || options.args)) throw new Error("--manifest, --executable and --args require --directory prebuilt mode.");
  const selected = target(options);
  const { plugin, entries, launch } = options.directory ? await directoryPayload(options) : await nodePayload(options, selected);
  await validateBlockPayloads(plugin, entries);
  const version = plugin.version.replace(/[^a-zA-Z0-9._-]/g, "_");
  const output = resolve(options.output ?? `${plugin.id}-${version}-${selected.os}-${selected.arch}.margin-plugin`);
  if (!output.endsWith(".margin-plugin")) throw new Error("Output filename must end in .margin-plugin.");
  const metadata = { packageVersion: "margin.package/v1", plugin, target: selected, launch };
  await writePackage(output, metadata, entries);
  return output;
}
async function validateBlockPayloads(plugin, entries) {
  for (const block of plugin.blocks ?? []) {
    const entry = entries.find(item => item.path === block.entry);
    if (!entry) throw new Error(`Block '${block.id}' needs packaged HTML at '${block.entry}'. Include it in margin.files or your prebuilt directory.`);
    const bytes = entry.bytes ?? await readFile(entry.source);
    if (bytes.length > 4 * 1024 * 1024) throw new Error(`Block '${block.id}' exceeds 4 MiB.`);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}
export async function main(args = process.argv.slice(2)) {
  console.log(`Package ready: ${await pack(args)}\nInstall this file in Margin Settings → Integrations → Plugins. No host Node or Python installation is required.`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(`Package failed: ${error.message}`); process.exitCode = 1; });
