import test from "node:test";
import assert from "node:assert/strict";
import { defineAction, definePlugin, createPluginServer, validateManifest, validateSchema, startPlugin } from "./index.mjs";
const token = "sdk-test-credential-0123456789abcdef";
const context = { actorId: "writer", publicationId: "publication-a" };
const schema = { type: "object", properties: { text: { type: "string", maxLength: 100 } }, required: ["text"], additionalProperties: false };
function plugin(handler = (input) => input, outputSchema = schema) {
  return definePlugin({ id: "sdk-test", name: "SDK test", version: "0.1.0", description: "Test service", capabilities: ["text.analysis"], actions: [defineAction({ name: "text.echo", title: "Echo", description: "Echo text", inputSchema: schema, outputSchema, handler })] });
}
async function serve(definition, options, run) {
  const server = createPluginServer(definition, { token, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await run(url); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
function call(url, input, requestContext = context) {
  return fetch(url + "/actions/text.echo", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ input, context: requestContext }) });
}
test("manifest validation rejects unsupported schema constraints and duplicates", () => {
  const manifest = structuredClone(plugin().manifest);
  manifest.actions[0].inputSchema.pattern = "secretly ignored";
  assert.throws(() => validateManifest(manifest), /unsupported/);
  const duplicate = structuredClone(plugin().manifest); duplicate.actions.push(duplicate.actions[0]);
  assert.throws(() => validateManifest(duplicate), /Duplicate action/);
  assert.throws(() => validateSchema({ type: "object", required: ["missing"] }), /required/);
  assert.throws(() => validateSchema({ type: "string", minLength: -1 }), /nonnegative/);
  assert.throws(() => validateSchema({ type: "object", properties: null }), /properties/);
  assert.throws(() => validateSchema({ type: "object", required: null }), /required/);
});
test("definition snapshots schemas so later changes cannot alter the contract", () => {
  const source = structuredClone(schema);
  const action = defineAction({ name: "text.echo", title: "Echo", description: "Echo", inputSchema: source, outputSchema: schema, handler: (input) => input });
  const defined = definePlugin({ id: "test", name: "Test", version: "1", description: "", capabilities: [], actions: [action] });
  source.properties.text.type = "number";
  assert.equal(defined.manifest.actions[0].inputSchema.properties.text.type, "string");
  assert.throws(() => { defined.manifest.actions[0].title = "changed"; }, TypeError);
});
test("weak secrets are rejected before binding", () => {
  assert.throws(() => createPluginServer(plugin(), { token: "weak" }), /PLUGIN_TOKEN/);
  assert.throws(() => createPluginServer(plugin(), { token, timeoutMs: 60000 }), /timeoutMs/);
});
test("manifest and actions require authentication and valid input", async () => {
  let calls = 0;
  await serve(plugin((input, ctx) => { calls++; assert.equal(ctx.publicationId, context.publicationId); assert.equal(ctx.actorId, context.actorId); return input; }), {}, async (url) => {
    assert.equal((await fetch(url + "/manifest")).status, 401);
    const manifest = await fetch(url + "/manifest", { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(manifest.status, 200); assert.equal((await manifest.json()).actions.length, 1);
    for (const input of [{}, { text: 4 }, { text: "ok", extra: true }, { text: "x".repeat(101) }]) assert.equal((await call(url, input)).status, 400);
    assert.equal((await call(url, { text: "hello" }, { actorId: "writer" })).status, 400);
    const valid = await call(url, { text: "hello" }); assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { output: { text: "hello" } });
    assert.equal(calls, 1);
  });
});
test("unexpected handler errors stay private and output obeys its schema", async () => {
  await serve(plugin(() => { throw new Error(token); }), {}, async (url) => {
    const response = await call(url, { text: "hello" }); assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(token));
  });
  await serve(plugin(() => ({ text: 7 })), {}, async (url) => assert.equal((await call(url, { text: "hello" })).status, 502));
});
test("responses have a hard size bound", async () => {
  const unbounded = { type: "object", additionalProperties: true };
  await serve(plugin(() => ({ huge: "x".repeat(256 * 1024) }), unbounded), {}, async (url) => assert.equal((await call(url, { text: "hello" })).status, 502));
});
test("timeout aborts work and does not release concurrency until the handler stops", async () => {
  let release; let signal;
  const blocked = new Promise((resolve) => { release = resolve; });
  await serve(plugin(async (input, ctx) => { signal = ctx.signal; await blocked; return input; }), { concurrency: 1, timeoutMs: 100 }, async (url) => {
    try {
      const response = await call(url, { text: "waiting" }); assert.equal(response.status, 504); assert.equal(signal.aborted, true);
      assert.equal((await call(url, { text: "busy" })).status, 429);
    } finally { release(); }
  });
});
test("startup prints connection instructions without exposing credentials", async () => {
  const logs = [];
  const server = await startPlugin(plugin(), { token, port: 0, log: (message) => logs.push(message) });
  try { assert.match(logs.join("\n"), /http:\/\/127.0.0.1:/); assert.match(logs.join("\n"), /\.env/); assert.ok(!logs.join("\n").includes(token)); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
