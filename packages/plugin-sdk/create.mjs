#!/usr/bin/env node
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockStarterHTML } from './create-block.mjs';
const localSDK = dirname(fileURLToPath(import.meta.url));
function argumentsFor(args) {
  const [command, name, ...flags] = args;
  if (command !== 'create' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name ?? '') || name.length > 64) throw new Error('Choose a lowercase name with hyphens, without a path: margin-plugin-create create my-plugin [--sdk path].');
  let sdk = localSDK;
  while (flags.length) {
    const flag = flags.shift();
    if (flag === '--block') continue;
    if (flag !== '--sdk' || !flags[0]) throw new Error('Supported option: --sdk /local/path/to/plugin-sdk.');
    sdk = flags.shift();
  }
  return { name, sdk };
}
function manifest(name) {
  return { apiVersion: 'margin.plugin/v1', id: name, name: 'Writing card', version: '0.1.0', description: 'Write and count words entirely in your browser.', capabilities: [], actions: [],
    blocks: [{ id: 'writing-card', title: 'Writing card', entry: 'block.html', defaultSource: '{"text":"Hello Margin"}', actions: [], reader: true }] };
}
async function starterFiles(name, sdk) {
  return {
    'package.json': JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', scripts: { check: 'margin-plugin-check manifest.json', pack: 'margin-plugin-pack --directory dist --manifest manifest.json', test: 'node --test plugin.test.mjs' }, dependencies: { '@margin/plugin-sdk': `file:${sdk}` } }, null, 2) + '\n',
    'manifest.json': JSON.stringify(manifest(name), null, 2) + '\n',
    'dist/block.html': blockStarterHTML(await readFile(join(sdk, 'browser.mjs'), 'utf8')),
    'plugin.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFile} from 'node:fs/promises';\nimport {validateManifest} from '@margin/plugin-sdk';\ntest('portable browser block',async()=>{const manifest=validateManifest(JSON.parse(await readFile('manifest.json','utf8')));assert.equal(manifest.actions.length,0);assert.match(await readFile('dist/block.html','utf8'),/connectBlock/);});\n`,
    '.gitignore': 'node_modules/\n*.margin-plugin\n.env*\n',
    'README.md': `# ${name}\n\nRun \`npm test && npm run check && npm run pack\`, then install the small .margin-plugin archive in Margin. This browser block runs on every Margin host: no Node/Python runtime, server process or credentials are packaged.\n\nEdit dist/block.html to change its UI; it includes the browser SDK inline. For larger projects bundle your framework and SDK into self-contained HTML. Only editor mode may call client.change; readers see saved content.\n\nFor server work, declare an HTTP action with schemas and http:{method:'POST',path:'/your/path',reader:false}. The owner configures the HTTPS base URL and API key in Margin. Never put URLs, secrets or server code in the package. Public actions require explicit reader:true plus owner opt-in.\n\nThe SDK is installed from a local checkout, not an npm registry. Node is only a developer build tool.\n`,
  };
}
export async function createProject(args, cwd = process.cwd()) {
  const { name, sdk } = argumentsFor(args), sdkPath = await realpath(resolve(sdk));
  if (JSON.parse(await readFile(join(sdkPath, 'package.json'), 'utf8')).name !== '@margin/plugin-sdk') throw new Error('--sdk must point to @margin/plugin-sdk.');
  const target = join(resolve(cwd), name);
  try { await mkdir(target); } catch (error) { if (error.code === 'EEXIST') throw new Error(`'${name}' already exists.`); throw error; }
  try {
    await mkdir(join(target, 'dist'));
    for (const [filename, content] of Object.entries(await starterFiles(name, sdkPath))) await writeFile(join(target, filename), content, { flag: 'wx' });
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, stdio: 'pipe', timeout: 60000 });
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  return target;
}
export async function main(args = process.argv.slice(2)) {
  const target = await createProject(args);
  console.log(`Browser plugin ready: ${target}\nNext: cd ${basename(target)} && npm test && npm run check && npm run pack`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
