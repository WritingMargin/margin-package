// Portable package lifecycle against the real engine, with no runtimes on PATH.
// node tests/plugin-browser-smoke.mjs [--live-http]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { writePackage } from '../packages/plugin-sdk/archive.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(path.join(tmpdir(), 'margin-browser-smoke-'));
const packageRoot = path.join(directory, 'plugins');
const databasePath = path.join(directory, 'margin.db');
const pluginPath = '/plugins/browser-smoke';
const framePath = '/plugin-blocks/browser-smoke/card/frame';
const publicAction = '/plugin-blocks/browser-smoke/card/actions/echo.public';
const secret = 'fixture-only-' + randomBytes(16).toString('hex');
const live = process.argv.includes('--live-http');
const objects = new Map();
let engine, base, cookie = '', storageURL;
const storage = createServer(async (request, response) => {
  const key = new URL(request.url, 'http://storage.test').pathname;
  if (request.method === 'HEAD') { response.end(); return; }
  if (request.method === 'PUT') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks)); response.end(); return;
  }
  if (request.method === 'DELETE') { objects.delete(key); response.writeHead(204).end(); return; }
  const bytes = objects.get(key);
  if (!bytes) { response.writeHead(404).end(); return; }
  response.end(bytes);
});
function manifest(version, id = 'browser-smoke') {
  const actions = ['echo.public', 'echo.owner'].map(name => ({
    name, title: name, inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
    outputSchema: { type: 'object' }, http: { method: 'POST', path: '/post', reader: name === 'echo.public' },
  }));
  return {
    apiVersion: 'margin.plugin/v1', id, name: 'Browser smoke', version,
    description: 'Portable browser integration fixture.', capabilities: ['text.echo'], actions,
    blocks: [
      { id: 'card', title: 'Browser card', entry: 'ui/card.html', actions: actions.map(action => action.name), reader: true },
      { id: 'display', title: 'Display only', entry: 'ui/card.html', actions: [], reader: true },
      { id: 'private', title: 'Owner only', entry: 'ui/card.html', actions: ['echo.public'], reader: false },
    ],
  };
}
async function createPackages() {
  const archives = {};
  for (const [name, version, id] of [['v1', '1.0.0'], ['v2', '2.0.0'], ['v3', '3.0.0'], ['wrong', '2.0.0', 'other-plugin']]) {
    const output = path.join(directory, `${name}.margin-plugin`);
    const metadata = { packageVersion: 'margin.package/v2', plugin: manifest(version, id) };
    await writePackage(output, metadata, [{ path: 'ui/card.html', bytes: Buffer.from(`<!doctype html><html><body><p>Portable browser card ${version}</p><script>window.fixtureVersion=${JSON.stringify(version)};</script></body></html>`) }]);
    archives[name] = await readFile(output);
  }
  // Keep the store-only ZIP and CRC intact; corrupt only a declared SHA-256.
  archives.badHash = rewriteManifest(archives.v3, text => {
    const digest = /"ui\/card\.html": "([a-f0-9]{64})"/.exec(text)?.[1];
    assert(digest, 'Missing fixture digest');
    return text.replace(digest, '0'.repeat(64));
  });
  archives.legacy = rewriteManifest(archives.v1, text => text.replace('margin.package/v2', 'margin.package/v1'));
  return archives;
}
function rewriteManifest(archive, transform) {
  const result = Buffer.from(archive);
  let offset = 0;
  while (result.readUInt32LE(offset) === 0x04034b50) {
    const size = result.readUInt32LE(offset + 18), nameLength = result.readUInt16LE(offset + 26), extraLength = result.readUInt16LE(offset + 28);
    const name = result.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'margin-package.json') {
      const text = result.subarray(start, start + size).toString();
      const changed = Buffer.from(transform(text));
      assert.equal(changed.length, size, 'Fixture mutations must preserve ZIP entry length');
      changed.copy(result, start);
      // Archive CRC is recomputed by the tiny helper below for both headers.
      const checksum = crc32(changed);
      result.writeUInt32LE(checksum, offset + 14);
      for (let central = start + size; central < result.length - 46; central++) {
        if (result.readUInt32LE(central) === 0x02014b50 && result.readUInt32LE(central + 42) === offset) { result.writeUInt32LE(checksum, central + 16); break; }
      }
      return result;
    }
    offset = start + size;
  }
  assert.fail('Package metadata not found');
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
async function start() {
  engine = spawn(path.join(root, 'artifacts/margin-server'), ['serve', '--host', '127.0.0.1', '--port', '0'], {
    cwd: directory, env: { PATH: '', HOME: directory, MARGIN_ENV: 'test', SQLITE_PATH: databasePath,
      MARGIN_PLUGIN_DIR: packageRoot, SETUP_TOKEN: 'browser-smoke', CONTENT_ENCRYPTION_KEY: 'ab'.repeat(32),
      NODE_OPTIONS: '--invalid-option-must-never-be-used', PYTHONHOME: '/no-python-runtime',
      S3_BUCKET: 'browser', S3_REGION: 'us-east-1', S3_ENDPOINT: storageURL, S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY_ID: 'fixture', S3_SECRET_ACCESS_KEY: 'fixture' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Engine startup timeout: ' + output)), 30000);
    engine.once('error', error => { clearTimeout(timer); reject(error); });
    engine.once('exit', code => { clearTimeout(timer); reject(new Error(`Engine exited ${code}: ${output}`)); });
    engine.stderr.on('data', bytes => { output = (output + bytes).slice(-16000); });
    engine.stdout.on('data', bytes => {
      output = (output + bytes).slice(-16000);
      const address = /Margin listening on (http:\/\/\S+)/.exec(output)?.[1];
      if (address) { clearTimeout(timer); resolve(address); }
    });
  });
}
async function stop() {
  if (!engine?.pid || engine.exitCode !== null || engine.signalCode !== null) return;
  const exited = once(engine, 'exit'), timeout = setTimeout(() => engine.kill('SIGKILL'), 12000);
  engine.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timeout); }
}
async function request(route, { method = 'GET', input, expected = 200, owner = true, headers = {}, bytes } = {}) {
  const response = await fetch(base + '/api' + route, {
    method, headers: { 'Content-Type': bytes ? 'application/zip' : 'application/json', Origin: base, Cookie: owner ? cookie : '', ...headers },
    ...(bytes ? { body: bytes } : input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(35000),
  });
  assert.equal(response.status, expected, `${method} ${route}: ${await response.clone().text()}`);
  return response;
}
const data = async (...args) => (await request(...args)).json();
const patch = async input => data(pluginPath, { method: 'PATCH', input });
const plugin = async () => (await data('/plugins')).plugins.find(value => value.id === 'browser-smoke');
const update = async (bytes, version, expected = 200) => data(pluginPath + '/package', { method: 'POST', bytes, expected, headers: version === undefined ? {} : { 'If-Match': JSON.stringify(version) } });
const publicCall = async (route = publicAction, expected = 403, headers = {}) => data(route, { method: 'POST', input: { input: { message: 'portable smoke' } }, owner: false, expected, headers });
function storedConnection() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try { return { ...database.prepare('SELECT * FROM plugin_http_connections WHERE plugin_id=?').get('browser-smoke') }; }
  finally { database.close(); }
}
async function frame(version) {
  const response = await request(framePath, { owner: false });
  assert.match(await response.text(), new RegExp(`Portable browser card ${version.replaceAll('.', '\\.')}`));
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts/); assert.doesNotMatch(csp, /allow-same-origin/); assert.match(csp, /connect-src 'none'/);
}
async function installAndReview(archives) {
  await request('/plugins', { expected: 401 });
  const setup = await request('/setup', { method: 'POST', input: { email: 'owner@example.com', password: 'correct horse battery', setupToken: 'browser-smoke' }, expected: 201 });
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const host = await data('/plugins/host');
  assert.equal(host.packageVersion, 'margin.package/v2'); assert.equal(host.packagesSupported, true); assert.equal(host.executionSupported, false);
  await request('/plugins/packages', { method: 'POST', bytes: archives.legacy, expected: 400 });
  await request('/plugins/packages', { method: 'POST', bytes: archives.badHash, expected: 400 });
  assert.deepEqual((await data('/plugins')).plugins, []);
  const installed = await data('/plugins/packages', { method: 'POST', bytes: archives.v1, expected: 201 });
  assert.equal(installed.enabled, false); assert.equal('endpoint' in installed, false); assert.equal(installed.packageVersion, 'margin.package/v2');
  assert.deepEqual((await data('/plugin-blocks', { owner: false })).blocks, []);
  await request(framePath, { owner: false, expected: 404 });
  await request('/plugins/packages', { method: 'POST', bytes: archives.v1, expected: 409 });
  assert.equal((await patch({ enabled: true })).enabled, true);
  await frame('1.0.0');
  await publicCall();
  await request(pluginPath + '/blocks/card/actions/echo.public', { method: 'POST', input: { input: { message: 'no connection' } }, expected: 409 });
  console.log('Installed and served a portable v2 browser package with empty PATH; legacy and bad-hash archives rejected.');
}
async function preserveStateAcrossUpdates(archives) {
  const http = { baseUrl: 'https://browser-smoke.invalid', authHeader: 'X-API-Key', authPrefix: '', apiKey: secret, readerEnabled: false };
  const configured = await patch({ http });
  assert.equal(configured.http.configured, true); assert.equal(configured.http.readerEnabled, false);
  assert(!JSON.stringify(configured).includes(secret));
  const connection = storedConnection();
  assert(connection.encrypted_key && connection.encrypted_key !== secret);
  const content = 'Before\n\n```plugin:browser-smoke:card\n{"note":"Keep my saved article"}\n```\n\nAfter';
  const post = await data('/posts', { method: 'POST', input: { title: 'Portable article', slug: 'portable-article', content }, expected: 201 });
  // Merely listing, loading a frame and replacing packages needs no API access.
  await data('/plugins'); await data('/plugin-blocks', { owner: false }); await frame('1.0.0');
  const updated = await update(archives.v2, '1.0.0');
  assert.equal(updated.version, '2.0.0'); assert.equal(updated.enabled, true);
  assert.deepEqual(updated.http, configured.http); assert.deepEqual(storedConnection(), connection);
  assert.equal((await data(`/posts/${post.id}`)).content, content);
  await frame('2.0.0');
  const before = await plugin();
  for (const [bytes, version, expected] of [[archives.v3, undefined, 428], [archives.v3, '1.0.0', 409], [archives.wrong, '2.0.0', 400], [archives.badHash, '2.0.0', 400], [archives.v2, '2.0.0', 409]]) {
    await update(bytes, version, expected); assert.deepEqual(await plugin(), before); assert.deepEqual(storedConnection(), connection);
  }
  await patch({ enabled: false });
  const disabled = await update(archives.v3, '2.0.0'); assert.equal(disabled.enabled, false); assert.equal(disabled.version, '3.0.0');
  await request(framePath, { owner: false, expected: 404 });
  await patch({ enabled: true }); await stop(); await start(); await frame('3.0.0');
  assert.deepEqual(storedConnection(), connection); assert.equal((await data(`/posts/${post.id}`)).content, content);
  console.log('Updates and restart preserve article content, encrypted HTTP connection, enabled state; rejected updates make no changes.');
}
async function readerPermissions() {
  await publicCall();
  let blocks = (await data('/plugin-blocks', { owner: false })).blocks;
  assert.deepEqual(blocks.find(block => block.id === 'card').readerActions, []);
  assert(!JSON.stringify(blocks).includes('browser-smoke.invalid')); assert(!JSON.stringify(blocks).includes(secret));
  await patch({ http: { baseUrl: 'https://browser-smoke.invalid', readerEnabled: true } });
  blocks = (await data('/plugin-blocks', { owner: false })).blocks;
  assert.deepEqual(blocks.find(block => block.id === 'card').readerActions, ['echo.public']);
  await publicCall('/plugin-blocks/browser-smoke/card/actions/echo.owner');
  await publicCall('/plugin-blocks/browser-smoke/display/actions/echo.public');
  await publicCall('/plugin-blocks/browser-smoke/private/actions/echo.public');
  await publicCall('/plugin-blocks/browser-smoke/card/actions/missing', 404);
  await publicCall(publicAction, 403, { Origin: 'https://unrelated.example' });
  if (live) {
    await patch({ http: { baseUrl: 'https://postman-echo.com', apiKey: '', readerEnabled: true } });
    const result = await publicCall(publicAction, 200);
    assert.deepEqual(result.output.json, { message: 'portable smoke' });
    assert.equal(result.output.headers['x-margin-actor-id'], 'reader');
    assert.equal(result.output.headers['x-api-key'], undefined);
    console.log('Opt-in live HTTPS action reached Postman Echo through the built-in Go bridge, without an API key.');
  }
  await patch({ http: { baseUrl: live ? 'https://postman-echo.com' : 'https://browser-smoke.invalid', readerEnabled: false } });
  await publicCall();
  await request(pluginPath, { method: 'DELETE' });
  assert.deepEqual((await data('/plugins')).plugins, []);
  assert.deepEqual((await data('/plugin-blocks', { owner: false })).blocks, []);
  assert.deepEqual(await readdir(packageRoot), []);
  console.log('Reader actions require owner opt-in, manifest permission, block permission and same origin; disable/remove closes access.');
}
try {
  const archives = await createPackages();
  storage.listen(0, '127.0.0.1'); await once(storage, 'listening');
  storageURL = `http://127.0.0.1:${storage.address().port}`;
  await start(); await installAndReview(archives); await preserveStateAcrossUpdates(archives); await readerPermissions();
  console.log('Portable browser plugin smoke passed.');
} finally {
  await stop(); storage.closeAllConnections(); await new Promise(resolve => storage.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
