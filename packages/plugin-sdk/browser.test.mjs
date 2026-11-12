import test from "node:test";
import assert from "node:assert/strict";
import { MessageChannel } from "node:worker_threads";
import { once } from "node:events";
import { BlockClient } from "./browser.mjs";
function fixture(mode = "edit") {
  const { port1, port2 } = new MessageChannel();
  const client = new BlockClient(port1, { mode, source: "original", theme: {} });
  return { client, port: port2, close() { client.close(); port2.close(); } };
}
test("block bridge routes results by request id and stages edits separately", async () => {
  const f = fixture();
  try {
    const message = once(f.port, "message");
    const action = f.client.action("text.count", { text: "Hello Margin" });
    const [request] = await message;
    assert.equal(request.type, "action");
    assert.equal(request.action, "text.count");
    f.port.postMessage({ id: "wrong", type: "result", output: { words: 999 } });
    f.port.postMessage({ id: request.id, type: "result", output: { words: 2 } });
    assert.deepEqual(await action, { words: 2 });
    const change = once(f.port, "message");
    f.client.change("new source");
    assert.deepEqual((await change)[0], { type: "change", source: "new source" });
    assert.equal(f.client.context.source, "original");
  } finally { f.close(); }
});
test("reader bridge rejects execution and changes; preview rejects changes", async () => {
  for (const mode of ["read", "preview"]) {
    const f = fixture(mode);
    try {
      assert.throws(() => f.client.change("mutated"), /editor/);
      if (mode === "read") await assert.rejects(f.client.action("text.count", {}), /Reader/);
    } finally { f.close(); }
  }
});
test("cancellation reaches host, ignores late results, and frees pending capacity", async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const started = once(f.port, "message");
    const action = f.client.action("scene.execute", {}, { signal: controller.signal });
    const rejected = assert.rejects(action, { name: "AbortError" });
    const [request] = await started;
    const cancelled = once(f.port, "message");
    controller.abort();
    assert.deepEqual((await cancelled)[0], { type: "cancel", id: request.id });
    await rejected;
    f.port.postMessage({ id: request.id, type: "result", output: {} });
    await assert.rejects(f.client.action("scene.execute", {}, { signal: controller.signal }), { name: "AbortError" });
  } finally { f.close(); }
});
test("bridge bounds data and closes all pending work", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.client.action("text.count", { text: "x".repeat(65536) }), /64 KiB/);
    assert.throws(() => f.client.change("x".repeat(1536 * 1024 + 1)), /1.5 MiB/);
    const pending = Array.from({ length: 4 }, () => assert.rejects(f.client.action("text.count", {}), /closed/));
    await assert.rejects(f.client.action("text.count", {}), /Wait/);
    f.client.close();
    await Promise.all(pending);
    await assert.rejects(f.client.action("text.count", {}), /closed/);
  } finally { f.close(); }
});
test("cleanup and download use bounded messages without exposing browser privileges", async () => {
  const f = fixture();
  try {
    const cleanup = once(f.port, "message");
    f.client.setCleanup("session.close", { sessionId: "test" });
    assert.deepEqual((await cleanup)[0], { type: "cleanup", action: "session.close", input: { sessionId: "test" } });
    assert.throws(() => f.client.setCleanup("session.close", { data: "x".repeat(4096) }), /4 KiB/);
    const download = once(f.port, "message");
    f.client.download("notebook.ipynb", "application/x-ipynb+json", "{}");
    assert.deepEqual((await download)[0], { type: "download", name: "notebook.ipynb", mime: "application/x-ipynb+json", text: "{}" });
    assert.throws(() => f.client.download("../secret", "text/plain", ""), /filename/);
    const cleared = once(f.port, "message");
    f.client.setCleanup(null);
    assert.deepEqual((await cleared)[0], { type: "cleanup", action: null });
  } finally { f.close(); }
  const reader = fixture("read");
  try { assert.throws(() => reader.client.setCleanup("session.close", {}), /Reader/); }
  finally { reader.close(); }
});
test("text imports use the host picker, preserve text, and permit explicit cancellation", async () => {
  const f = fixture();
  try {
    const requested = once(f.port, "message");
    const imported = f.client.importTextFile({ accept: ".ipynb,application/json", maxBytes: 1024 });
    const [request] = await requested;
    assert.deepEqual(request, { id: "1", type: "import", accept: ".ipynb,application/json", maxBytes: 1024 });
    await assert.rejects(f.client.importTextFile(), /current file import/);
    f.port.postMessage({ id: request.id, type: "result", output: { name: "notes.ipynb", text: "{\"cells\":[]}" } });
    assert.deepEqual(await imported, { name: "notes.ipynb", text: "{\"cells\":[]}" });
    const next = once(f.port, "message");
    const cancelled = f.client.importTextFile();
    const [second] = await next;
    f.port.postMessage({ id: second.id, type: "result", output: null });
    assert.equal(await cancelled, null);
  } finally { f.close(); }
});
test("imports reject non-editor access, invalid filters, and oversized UTF-8 results", async () => {
  for (const mode of ["read", "preview"]) {
    const f = fixture(mode);
    try { await assert.rejects(f.client.importTextFile(), /editor/); }
    finally { f.close(); }
  }
  const f = fixture();
  try {
    await assert.rejects(f.client.importTextFile({ accept: "../../private" }), /file types/);
    await assert.rejects(f.client.importTextFile({ maxBytes: 1536 * 1024 + 1 }), /1.5 MiB/);
    const requested = once(f.port, "message");
    const imported = f.client.importTextFile({ maxBytes: 4 });
    const rejected = assert.rejects(imported, /oversized/);
    const [request] = await requested;
    f.port.postMessage({ id: request.id, type: "result", output: { name: "file.txt", text: "€€" } });
    await rejected;
  } finally { f.close(); }
});
test("closing a block aborts a pending file chooser and rejects late delivery", async () => {
  const f = fixture();
  try {
    const requested = once(f.port, "message");
    const imported = f.client.importTextFile();
    const rejected = assert.rejects(imported, /closed/);
    await requested;
    const cancelled = once(f.port, "message");
    f.client.close();
    assert.equal((await cancelled)[0].type, "cancel");
    await rejected;
  } finally { f.close(); }
});
