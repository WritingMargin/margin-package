import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pluginHandler } from "./index.mjs";
import { validateValue } from "./schema.mjs";
class HTTPFailure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HTTPFailure(status, message); };
function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
function authorized(header, token) {
  const digest = (value) => createHash("sha256").update(value).digest();
  return typeof header === "string" && timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}
function integer(value, low, high, name) {
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${name} must be an integer from ${low} to ${high}.`);
  return value;
}
function serviceOptions(options) {
  const token = options.token ?? process.env.PLUGIN_TOKEN;
  if (typeof token !== "string" || token.length < 24 || token.length > 8192 || /\s/.test(token)) throw new Error("Set PLUGIN_TOKEN to a random secret of at least 24 characters. The starter keeps it in .env.");
  return { token, concurrency: integer(options.concurrency ?? 4, 1, 4, "concurrency"), timeoutMs: integer(options.timeoutMs ?? 25000, 100, 25000, "timeoutMs"), onError: options.onError ?? (() => {}) };
}
function validContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  if (Object.keys(context).some((key) => !["actorId", "publicationId"].includes(key))) return false;
  return [context.actorId, context.publicationId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 200);
}
async function readInput(request, schema) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) fail(415, "Send Content-Type: application/json.");
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 72 * 1024) fail(413, "Request exceeds 72 KiB.");
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "Request must be valid JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(400, "Request must be an object.");
  if (Object.keys(payload).some((key) => !["input", "context"].includes(key))) fail(400, "Request contains unknown fields.");
  if (!validContext(payload.context)) fail(400, "Provide context.actorId and context.publicationId from Margin.");
  validateInput(schema, payload.input);
  return payload;
}
function validateInput(schema, input) {
  try {
    validateValue(schema, input);
    if (Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) fail(413, "Input exceeds 64 KiB.");
  } catch (error) {
    if (error instanceof HTTPFailure) throw error;
    fail(400, error.message);
  }
}
function actionOutput(schema, output) {
  try {
    validateValue(schema, output, "output");
    const serialized = JSON.stringify({ output });
    if (Buffer.byteLength(serialized) > 256 * 1024) fail(502, "Plugin output exceeds 256 KiB.");
    // Validate exactly what will cross the wire (toJSON and undefined can alter objects).
    const wire = JSON.parse(serialized);
    validateValue(schema, wire.output, "output");
    return wire;
  } catch (error) {
    if (error instanceof HTTPFailure) throw error;
    fail(502, "Plugin output does not match its declared schema.");
  }
}
async function runAction(request, action, handler, signal) {
  const payload = await readInput(request, action.inputSchema);
  if (signal.aborted) fail(504, "Plugin action timed out.");
  const context = Object.freeze({ ...payload.context, signal });
  const output = await handler(payload.input, context);
  return actionOutput(action.outputSchema, output);
}
async function dispatchAction(request, response, action, handler, options, state) {
  if (state.active >= options.concurrency) return send(response, 429, { error: "Plugin is busy. Try again shortly." });
  state.active++;
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  response.once("close", disconnect);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new HTTPFailure(504, "Plugin action timed out.")); }, options.timeoutMs);
  });
  // Keep the slot occupied until actual work stops, even after HTTP timeout.
  const execution = runAction(request, action, handler, controller.signal).finally(() => {
    state.active--; clearTimeout(timer); response.off("close", disconnect);
  });
  try { send(response, 200, await Promise.race([execution, timeout])); }
  catch (error) { reportFailure(response, error, options); }
}
function reportFailure(response, error, options) {
  if (error instanceof HTTPFailure) return send(response, error.status, { error: error.message });
  try { options.onError(error); } catch { /* Logging must not break request cleanup. */ }
  send(response, 500, { error: "Plugin action failed." });
}
export function createPluginServer(plugin, options = {}) {
  const config = serviceOptions(options);
  const state = { active: 0 };
  const actions = new Map(plugin.manifest.actions.map((action) => [action.name, { action, handler: pluginHandler(plugin, action.name) }]));
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    if (!authorized(request.headers.authorization, config.token)) return send(response, 401, { error: "Unauthorized." });
    if (request.method === "GET" && request.url === "/manifest") return send(response, 200, plugin.manifest);
    const name = request.url?.startsWith("/actions/") ? request.url.slice(9) : "";
    const selected = actions.get(name);
    if (request.method !== "POST" || !selected) return send(response, 404, { error: "Action not found." });
    void dispatchAction(request, response, selected.action, selected.handler, config, state);
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000; server.timeout = 30000;
  server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  return server;
}
export async function startPlugin(plugin, options = {}) {
  const host = options.host ?? process.env.PLUGIN_HOST ?? "127.0.0.1";
  const port = integer(options.port ?? Number(process.env.PLUGIN_PORT ?? 8789), 0, 65535, "port");
  const server = createPluginServer(plugin, options);
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, host, accept); });
  const bound = server.address();
  const displayHost = host.includes(":") ? `[${host}]` : host;
  const log = options.log ?? console.log;
  log(`${plugin.manifest.name} is ready at http://${displayHost}:${bound.port}`);
  log(`In Margin, open Settings → Integrations → Plugins and connect this address.`);
  log(`Use PLUGIN_TOKEN from ${resolve(".env")} (or your configured environment). Credentials are never printed here.`);
  return server;
}
