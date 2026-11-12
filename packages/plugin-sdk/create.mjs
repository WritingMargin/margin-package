#!/usr/bin/env node
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockStarterHTML } from "./create-block.mjs";
const localSDK = dirname(fileURLToPath(import.meta.url));
function argumentsFor(args) {
  const [command, name, ...flags] = args;
  if (command !== "create" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name ?? "") || name.length > 64) throw new Error("Usage: margin-plugin-create create my-plugin [--sdk /local/path/to/plugin-sdk]. Choose a lowercase name with hyphens, without a path.");
  let sdk = localSDK, block = false;
  while (flags.length) {
    const flag = flags.shift();
    if (flag === "--block" && !block) block = true;
    else if (flag === "--sdk" && flags[0] && !flags[0].startsWith("--")) sdk = flags.shift();
    else throw new Error("Supported options: --block and --sdk /local/path/to/plugin-sdk.");
  }
  return { name, sdk, block };
}
async function sdkLocation(path) {
  const absolute = await realpath(resolve(path));
  const pkg = JSON.parse(await readFile(join(absolute, "package.json"), "utf8"));
  if (pkg.name !== "@margin/plugin-sdk") throw new Error("--sdk must point to the local @margin/plugin-sdk package.");
  await readFile(join(absolute, "index.mjs"));
  return absolute;
}
function pluginSource(name, block) {
  return `import { defineAction, definePlugin } from "@margin/plugin-sdk";

// Change the schemas and handler together. Input types are inferred for you.
export const countWords = defineAction({
  name: "text.count",
  title: "Count my words",
  description: "Count words and characters without storing your writing.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", maxLength: 12000 } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      words: { type: "integer", minimum: 0 },
      characters: { type: "integer", minimum: 0 },
    },
    required: ["words", "characters"],
    additionalProperties: false,
  },
  handler(input, context) {
    // Use context.publicationId + context.actorId to scope any saved state.
    // Pass context.signal to fetch() or other cancellable work.
    context.signal.throwIfAborted();
    const words = [...new Intl.Segmenter("en", { granularity: "word" }).segment(input.text)]
      .filter((segment) => segment.isWordLike).length;
    return { words, characters: [...input.text].length };
  },
});

export default definePlugin({
  id: ${JSON.stringify(name)},
  name: ${JSON.stringify(name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "))},
  version: "0.1.0",
  description: "A small tool to help your writing.",
  capabilities: ["text.analysis"],
  actions: [countWords],
${block ? '  blocks: [{ id: "writing-card", title: "Writing card", description: "A space for words with its own editor and reader view.", entry: "app/block.html", defaultSource: \'{"text":"Hello Margin"}\', actions: ["text.count"], reader: true }],\n' : ''}
});
`;
}
function starterFiles(name, sdk, block, browserSource) {
  const pkg = { name, version: "0.1.0", private: true, type: "module", engines: { node: ">=24" }, scripts: { dev: "node --env-file=.env --watch server.ts", start: "node --env-file=.env server.ts", check: "margin-plugin-check plugin.ts", pack: "margin-plugin-pack plugin.ts --entry server.ts", test: "node --test plugin.test.mjs" }, dependencies: { "@margin/plugin-sdk": `file:${sdk}` } };
  if (block) pkg.margin = { files: ["plugin.ts", "server.ts", "block.html"] };
  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "plugin.ts": pluginSource(name, block),
    ...(block ? { "block.html": blockStarterHTML(browserSource) } : {}),
    "server.ts": `import { startPlugin } from "@margin/plugin-sdk";\nimport plugin from "./plugin.ts";\n\nconst server = await startPlugin(plugin);\nfor (const signal of ["SIGINT", "SIGTERM"]) {\n  process.once(signal, () => { server.close(); server.closeIdleConnections(); });\n}\n`,
    "plugin.test.mjs": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { countWords } from "./plugin.ts";\n\ntest("counts writing without storing it", async () => {\n  const context = { actorId: "writer", publicationId: "test-publication", signal: new AbortController().signal };\n  assert.deepEqual(await countWords.handler({ text: "Hello, Margin!" }, context), { words: 2, characters: 14 });\n});\n`,
    ".env": `# Local secret. Keep this file out of git.\nPLUGIN_TOKEN=${randomBytes(32).toString("hex")}\nPLUGIN_HOST=127.0.0.1\nPLUGIN_PORT=8789\n`,
    ".gitignore": "node_modules/\n.env\n*.log\n*.margin-plugin\n",
    "README.md": starterReadme(name) + (block ? "\n## Your editor block\n\nAfter installing and enabling the package, open an article and choose **Plugin block → Writing card**. Edit your words, run the counter, and choose **Insert block**. The reader view shows the saved words and count without executing actions.\n\nEdit block.html to change your UI. It includes the browser SDK inline so it runs without external assets. Its script uses connectBlock() for source, theme, scoped actions and staged changes. Only edit mode can change source; public read mode cannot run backend actions. For larger UIs, bundle @margin/plugin-sdk/browser and your framework into a self-contained HTML file.\n" : ""),
  };
}
function starterReadme(name) {
  return `# ${name}\n\nBuild and install your plugin with Node.js 24 or later on your development machine.\n\n1. Run \`npm test\` and \`npm run check\`.\n2. Run \`npm run pack\` to bundle the app, SDK and Node runtime into a \`.margin-plugin\` file.\n3. Install that file in Margin **Settings → Integrations → Plugins**, review it, and enable it. The engine needs no installed Node or manually configured endpoint.\n4. Try **Count my words** in **Manage → Developer tools** with \`Hello Margin\`.\n\nThe package targets this computer's OS and architecture. Use \`npm run pack -- --runtime /path/to/target/node --os linux --arch arm64\` for another host. Keep the official Node distribution LICENSE alongside the binary or pass --runtime-license.\n\n## Develop\n\nEdit plugin.ts schemas and handlers together; handler types are inferred. npm test checks behavior; npm run check validates the manifest, not TypeScript compilation. Use your own tsc setup for CI typechecking.\n\nOptional: \`npm run dev\` starts a watched local service. Its private token lives in .env and is never packed. The finished package needs no development service or token configuration.\n\nThe SDK is a local dependency, not a published npm package. Keep its checkout available while developing. Add app modules/assets through package.json margin.files; by default only plugin.ts and server.ts are included. No automatic arbitrary node_modules bundling.\n\nPackages execute trusted native code, not sandboxed handlers. Store state in PLUGIN_DATA_DIR, scope it to publicationId and actorId, and honor context.signal. Removing a package deletes its data; v1 replaces packages through remove/reinstall.\n`;
}

export async function createProject(args, cwd = process.cwd()) {
  const { name, sdk, block } = argumentsFor(args);
  const sdkPath = await sdkLocation(sdk);
  const target = join(resolve(cwd), name);
  try { await mkdir(target); }
  catch (error) { if (error.code === "EEXIST") throw new Error(`'${name}' already exists. Choose a new name; existing files are never replaced.`); throw error; }
  try {
    const browserSource = block ? await readFile(join(sdkPath, "browser.mjs"), "utf8") : "";
    for (const [filename, content] of Object.entries(starterFiles(name, sdkPath, block, browserSource))) {
      await writeFile(join(target, filename), content, { flag: "wx", mode: filename === ".env" ? 0o600 : 0o644 });
    }
    execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: target, stdio: "pipe", timeout: 60000 });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw new Error(`Could not create ${name}: ${error.message}`, { cause: error });
  }
  return target;
}
export async function main(args = process.argv.slice(2)) {
  const target = await createProject(args);
  console.log(`Your plugin is ready in ${target}\n\nNext: cd ${basename(target)} && npm test && npm run check && npm run pack\n\nInstall the package in Margin → Settings → Integrations → Plugins.\nOptional local service development: npm run dev (uses the private .env file).`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
