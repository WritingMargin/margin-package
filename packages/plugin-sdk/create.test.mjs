import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createProject } from "./create.mjs";
const sdk = dirname(fileURLToPath(import.meta.url));
async function temporary(run) {
  const dir = await mkdtemp(join(tmpdir(), "margin-sdk-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test("scaffolder rejects traversal and never replaces an existing project", async () => temporary(async (dir) => {
  for (const name of ["../escape", "/absolute", "nested/path", ".", "..", "Bad Name", "a;echo-danger"]) await assert.rejects(createProject(["create", name], dir), /lowercase name/);
  await mkdir(join(dir, "existing")); await writeFile(join(dir, "existing", "keep.txt"), "untouched");
  await assert.rejects(createProject(["create", "existing"], dir), /already exists/);
  assert.equal(await readFile(join(dir, "existing", "keep.txt"), "utf8"), "untouched");
}));
test("one create command produces a runnable checked starter with private credentials", async () => temporary(async (dir) => {
  const target = await createProject(["create", "my-tool", "--sdk", sdk], dir);
  const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@margin/plugin-sdk"], `file:${sdk}`);
  const env = await readFile(join(target, ".env"), "utf8");
  assert.match(env, /PLUGIN_TOKEN=[a-f0-9]{64}/); assert.equal((await stat(join(target, ".env"))).mode & 0o777, 0o600);
  assert.match(await readFile(join(target, ".gitignore"), "utf8"), /\.env/);
  execFileSync("npm", ["test"], { cwd: target, stdio: "pipe" });
  const checked = execFileSync("npm", ["run", "check"], { cwd: target, encoding: "utf8" });
  assert.match(checked, /compatible with margin.plugin\/v1/);
  const manifest = JSON.parse(execFileSync(process.execPath, [join(sdk, "check.mjs"), join(target, "plugin.ts"), "--json"], { encoding: "utf8" }));
  assert.equal(manifest.actions[0].name, "text.count");
  assert.ok(!checked.includes(env.match(/PLUGIN_TOKEN=(.+)/)[1]));
  const source = await readFile(join(target, "plugin.ts"), "utf8");
  await writeFile(join(target, "plugin.ts"), source.replace("maxLength: 12000", 'pattern: "unsupported"'));
  assert.throws(() => execFileSync("npm", ["run", "check"], { cwd: target, stdio: "pipe" }), (error) => error.status !== 0 && error.stderr.toString().includes("unsupported"));
}));
test("block starter carries its UI, scoped action and reader view in the package definition", async () => temporary(async (dir) => {
  const target = await createProject(["create", "writing-card", "--block", "--sdk", sdk], dir);
  const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(pkg.margin.files, ["plugin.ts", "server.ts", "block.html"]);
  const manifest = JSON.parse(execFileSync(process.execPath, [join(sdk, "check.mjs"), join(target, "plugin.ts"), "--json"], { encoding: "utf8" }));
  assert.equal(manifest.blocks[0].entry, "app/block.html");
  assert.equal(manifest.blocks[0].reader, true);
  assert.deepEqual(manifest.blocks[0].actions, ["text.count"]);
  const html = await readFile(join(target, "block.html"), "utf8");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /connectBlock\(\)/);
  assert.match(html, /client.change/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  execFileSync("npm", ["test"], { cwd: target, stdio: "pipe" });
}));
