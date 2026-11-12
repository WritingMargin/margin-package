#!/usr/bin/env node
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPlugin } from './check.mjs';
import { safePath, rejectSecretPath, writePackage } from './archive.mjs';
function parse(args) {
  const values = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--directory', '--manifest', '--output'].includes(flag) || !args.length || values[flag.slice(2)]) throw new Error('Usage: margin-plugin-pack --directory dist --manifest manifest.json [--output plugin.margin-plugin]. Packages contain browser assets only; no runtime, executable, server or target options.');
    values[flag.slice(2)] = args.shift();
  }
  if (!values.directory || !values.manifest) throw new Error('Provide --directory containing bundled browser assets and --manifest.');
  return values;
}
const assetExtensions = /\.(?:html|css|js|mjs|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|txt|md)$/i;
async function addTree(entries, root, name) {
  safePath(name); rejectSecretPath(name);
  if (name.split('/').some(part => ['node_modules', 'runtime', 'server'].includes(part.toLowerCase()))) throw new Error('Only bundled browser assets belong in a portable package.');
  const source = join(root, name), info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not package payloads: ${name}`);
  if (info.isDirectory()) {
    for (const child of (await readdir(source)).sort()) await addTree(entries, root, `${name}/${child}`);
  } else if (info.isFile() && (assetExtensions.test(name) || /(?:^|\/)(?:LICENSE|COPYING)(?:[-.].*)?$/i.test(name))) entries.push({ path: name, source });
  else throw new Error(`Not a browser asset: ${name}`);
  if (entries.length > 19999) throw new Error('Package exceeds 20000 files.');
}
export async function pack(args) {
  const options = parse([...args]);
  const plugin = await checkPlugin(options.manifest);
  for (const action of plugin.actions) if (!action.http) throw new Error(`Portable action '${action.name}' needs an explicit HTTP mapping; JavaScript runs in the browser UI.`);
  const entries = [], root = await realpath(resolve(options.directory));
  for (const name of (await readdir(root)).sort()) await addTree(entries, root, name);
  for (const block of plugin.blocks ?? []) {
    const entry = entries.find(item => item.path === block.entry);
    if (!entry) throw new Error(`Block '${block.id}' needs packaged HTML at '${block.entry}'.`);
    const bytes = await readFile(entry.source);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Block HTML exceeds 4 MiB.');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const output = resolve(options.output ?? `${plugin.id}-${plugin.version.replace(/[^a-zA-Z0-9._-]/g, '_')}.margin-plugin`);
  if (!output.endsWith('.margin-plugin')) throw new Error('Output filename must end in .margin-plugin.');
  await writePackage(output, { packageVersion: 'margin.package/v2', plugin }, entries);
  return output;
}
export async function main(args = process.argv.slice(2)) { console.log(`Portable browser package ready: ${await pack(args)}`); }
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main().catch(error => { console.error(`Package failed: ${error.message}`); process.exitCode = 1; });
