import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writePackage, safePath, rejectSecretPath } from "./archive.mjs";
import { validateManifest } from "./schema.mjs";
import { pack } from "./pack.mjs";
const manifest = { apiVersion: "margin.plugin/v1", id: "pack-test", name: "Pack test", version: "1", description: "Test", capabilities: [], actions: [{ name: "text.echo", title: "Echo", description: "", inputSchema: { type: "object" }, outputSchema: { type: "object" } }] };
const metadata = { packageVersion: "margin.package/v1", plugin: manifest, target: { os: "linux", arch: "amd64" }, launch: { executable: "runtime/app", args: [] } };
function unzipStored(bytes) {
  const entries = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extra;
    entries.set(name, bytes.subarray(start, start + size)); offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return entries;
}
test("archive contains regular payloads, metadata and verifiable hashes; tampering changes digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "margin-pack-test-"));
  try {
    const output = join(root, "test.margin-plugin");
    await writePackage(output, metadata, [{ path: "runtime/app", bytes: Buffer.from("binary") }, { path: "app/data.json", bytes: Buffer.from("{}") }]);
    const files = unzipStored(await readFile(output));
    const stored = JSON.parse(files.get("margin-package.json"));
    assert.equal(stored.packageVersion, "margin.package/v1");
    for (const [path, digest] of Object.entries(stored.files)) assert.equal(createHash("sha256").update(files.get(path)).digest("hex"), digest);
    files.get("runtime/app")[0] ^= 1;
    assert.notEqual(createHash("sha256").update(files.get("runtime/app")).digest("hex"), stored.files["runtime/app"]);
    await assert.rejects(writePackage(output, metadata, []), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("unsafe paths, secrets, duplicate case variants and oversized file counts are refused", async () => {
  for (const path of ["../outside", "/absolute", "a/../b", "a\\b", "a:b", "a//b"]) assert.throws(() => safePath(path), /Unsafe/);
  for (const path of [".env", "app/.env.production", "key.pem", ".git/config", "id_rsa"]) assert.throws(() => rejectSecretPath(path), /Refusing/);
  await assert.rejects(writePackage("unused.margin-plugin", metadata, [{ path: "App", bytes: Buffer.alloc(0) }, { path: "app", bytes: Buffer.alloc(0) }]), /Duplicate/);
  await assert.rejects(writePackage("unused.margin-plugin", metadata, Array(20000).fill({ path: "x", bytes: Buffer.alloc(0) })), /20000/);
});
test("native helper executables retain only sanitized executable permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "margin-pack-mode-"));
  try {
    const helper = join(root, "helper");
    await writeFile(helper, "helper"); await chmod(helper, 0o755);
    const output = join(root, "test.margin-plugin");
    await writePackage(output, metadata, [{ path: "runtime/app", bytes: Buffer.from("main") }, { path: "runtime/helper", source: helper }]);
    const bytes = await readFile(output);
    const end = bytes.length - 22;
    let offset = bytes.readUInt32LE(end + 16);
    const modes = new Map();
    while (bytes.readUInt32LE(offset) === 0x02014b50) {
      const length = bytes.readUInt16LE(offset + 28);
      const name = bytes.subarray(offset + 46, offset + 46 + length).toString();
      modes.set(name, bytes.readUInt32LE(offset + 38) >>> 16);
      offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    assert.equal(modes.get("runtime/helper"), 0o100700);
    assert.equal(modes.get("runtime/app"), 0o100700);
    assert.equal(modes.get("margin-package.json"), 0o100600);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("directory packaging rejects symlinks and never overwrites an existing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "margin-pack-cli-"));
  try {
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await symlink("manifest.json", join(root, "runtime"));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./pack.mjs", import.meta.url)), "--directory", root, "--manifest", join(root, "manifest.json"), "--executable", "runtime", "--output", join(root, "test.margin-plugin")], { encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Symlinks/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("hook schemas accept known events and reject undeclared actions, duplicates and unknown events", () => {
  assert.equal(validateManifest({ ...manifest, hooks: [{ event: "post.published", action: "text.echo" }] }).hooks.length, 1);
  for (const hooks of [[{ event: "post.deleted", action: "text.echo" }], [{ event: "post.published", action: "missing" }], [{ event: "post.published", action: "text.echo" }, { event: "post.published", action: "text.echo" }]]) assert.throws(() => validateManifest({ ...manifest, hooks }));
});
test("block packaging requires the declared UI and hashes its exact bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "margin-block-pack-"));
  try {
    const source = { ...manifest, blocks: [{ id: "card", title: "Card", entry: "card.html", actions: [], reader: true }] };
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(source));
    await writeFile(join(root, "runtime"), "test-runtime");
    const output = root + ".margin-plugin";
    const args = ["--directory", root, "--manifest", manifestPath, "--executable", "runtime", "--output", output];
    await assert.rejects(pack(args), /needs packaged HTML/);
    const html = "<!doctype html><h1>Plugin-owned UI</h1>";
    await writeFile(join(root, "card.html"), html);
    await pack(args);
    try {
      const files = unzipStored(await readFile(output));
      const stored = JSON.parse(files.get("margin-package.json"));
      assert.equal(stored.files["card.html"], createHash("sha256").update(html).digest("hex"));
      assert.equal(files.get("card.html").toString(), html);
    } finally { await rm(output); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
