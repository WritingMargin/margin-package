// Opt-in real Three.js package test. The harness uses Node, but Margin and its
// managed plugin need no system Node: the engine starts with an empty PATH.
// node tests/three-package-smoke.mjs /path/to/three-scene.margin-plugin
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 3, 'Usage: node tests/three-package-smoke.mjs /path/to/three-scene.margin-plugin');
const archive = path.resolve(process.argv[2]);
await access(archive);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binary = path.join(root, 'artifacts/margin-server');
await access(binary);
const directory = await mkdtemp(path.join(tmpdir(), 'margin-three-package-smoke-'));
const packageRoot = path.join(directory, 'plugins');
const pluginPath = '/plugins/three-scene';
let engine;
let base;
let cookie = '';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const sceneCode = `
const geometry = new THREE.BoxGeometry(2, 3, 4);
const material = new THREE.MeshStandardMaterial({ color: 0x3366ff, roughness: 0.35, metalness: 0.15 });
const box = new THREE.Mesh(geometry, material);
box.name = "smoke-box";
box.position.set(1, 2, 3);
scene.add(box);
const key = new THREE.DirectionalLight(0xffffff, 2);
key.name = "smoke-key";
key.position.set(2, 4, 3);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
scene.background = new THREE.Color(0xf0f4ff);
camera.position.set(7, 6, 5);
camera.fov = 50;
target.set(0, 1, 0);
const track = new THREE.NumberKeyframeTrack("smoke-box.rotation[y]", [0, 1, 2], [0, Math.PI, 2 * Math.PI]);
animations.push(new THREE.AnimationClip("Turn the box", 2, [track]));
console.log("THREE revision", THREE.REVISION);
`;
const recoveryCode = 'scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff8844 }))); console.log("recovered");';

async function until(read, accepts, label, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function startEngine() {
  engine = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', '0'], {
    cwd: directory,
    env: {
      PATH: '', HOME: directory, MARGIN_ENV: 'test', SQLITE_PATH: path.join(directory, 'margin.db'),
      MARGIN_PLUGIN_DIR: packageRoot, SETUP_TOKEN: 'three-package-smoke', CONTENT_ENCRYPTION_KEY: 'ab'.repeat(32),
      // A packaged runtime must not inherit the engine's ambient Node options.
      NODE_OPTIONS: '--invalid-margin-smoke-option',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Engine startup timeout: ${output}`)), 30000);
    const append = data => { output = (output + data).slice(-16384); };
    engine.once('error', error => { clearTimeout(timer); reject(error); });
    engine.once('exit', code => { clearTimeout(timer); reject(new Error(`Engine exited ${code}: ${output}`)); });
    engine.stderr.on('data', append);
    engine.stdout.on('data', data => {
      append(data);
      const address = /Margin listening on (http:\/\/\S+)/.exec(output)?.[1];
      if (address) { clearTimeout(timer); resolve(address); }
    });
  });
}
async function stopEngine() {
  if (!engine || engine.exitCode !== null || engine.signalCode !== null) return;
  const exited = once(engine, 'exit');
  const timeout = setTimeout(() => engine.kill('SIGKILL'), 12000);
  engine.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timeout); }
}
async function call(route, method = 'GET', input, status = 200, headers = {}) {
  const response = await fetch(base + '/api' + route, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie, ...headers },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(35000),
  });
  assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const execute = async code => (await data(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code } })).output;
function descendants(object) { return [object, ...(object.children ?? []).flatMap(descendants)]; }
async function setupAndInstall() {
  await call('/plugins', 'GET', undefined, 401);
  const setup = await call('/setup', 'POST', { email: 'owner@example.com', password: 'correct horse battery', setupToken: 'three-package-smoke' }, 201);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await data('/plugins')).plugins, []);
  assert.equal((await data('/plugins/host')).executionSupported, true);
  const response = await fetch(base + '/api/plugins/packages', {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'Content-Length': String((await stat(archive)).size), Origin: base, Cookie: cookie },
    body: createReadStream(archive), duplex: 'half', signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 201, `Package installation: ${await response.clone().text()}`);
  const installed = await response.json();
  assert.equal(installed.id, 'three-scene');
  assert.equal(installed.installation, 'package');
  assert.equal(installed.enabled, false);
  assert(installed.capabilities.includes('scene.execute'));
  await call(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code: sceneCode } }, 409);
  const enabled = await data(pluginPath, 'PATCH', { enabled: true });
  assert.equal(enabled.runtimeStatus, 'running');
  assert.equal((await fetch(enabled.endpoint + '/manifest')).status, 401);
  await call(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code: sceneCode } }, 401, { Cookie: '' });
  const ownerToken = (await data('/tokens', 'POST', { name: 'Three smoke', role: 'owner' }, 201)).token;
  await call(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code: sceneCode } }, 403, { Authorization: `Bearer ${ownerToken}` });
  console.log('Installed and enabled bundled Three.js with empty PATH; verified session-only and service authentication.');
}
function assertGeometry(geometry) {
  assert.equal(geometry.type, 'BufferGeometry');
  const position = geometry.data.attributes.position;
  assert.equal(position.itemSize, 3);
  assert(position.array.length > 0);
  const bounds = [0, 1, 2].map(axis => {
    const values = position.array.filter((_, index) => index % 3 === axis);
    return [Math.min(...values), Math.max(...values)];
  });
  assert.deepEqual(bounds, [[-1, 1], [-1.5, 1.5], [-2, 2]], 'Real BoxGeometry dimensions were not serialized.');
}
function assertScene(result) {
  assert.equal(result.ok, true, result.error);
  const scene = result.scene;
  assert.equal(scene.object.type, 'Scene');
  const objects = descendants(scene.object);
  const box = objects.find(object => object.name === 'smoke-box');
  assert.equal(box?.type, 'Mesh');
  assertGeometry(scene.geometries.find(geometry => geometry.uuid === box.geometry));
  const material = scene.materials.find(item => item.uuid === box.material);
  assert.equal(material.type, 'MeshStandardMaterial');
  assert.equal(material.color, 0x3366ff);
  assert.equal(material.roughness, 0.35);
  assert.equal(material.metalness, 0.15);
  assert.deepEqual(box.matrix.slice(12, 15), [1, 2, 3]);
  assert.equal(objects.find(object => object.name === 'smoke-key')?.type, 'DirectionalLight');
  assert(objects.some(object => object.type === 'AmbientLight'));
  assert.deepEqual(result.camera, { position: [7, 6, 5], target: [0, 1, 0], fov: 50 });
  assert(result.logs.some(log => /THREE revision\s+\d+/.test(log)));
  assert.equal(result.animations[0].name, 'Turn the box');
  assert.equal(result.animations[0].tracks[0].name, 'smoke-box.rotation[y]');
  assert.deepEqual(result.animations[0].tracks[0].times, [0, 1, 2]);
}
async function executionAndRecovery() {
  assertScene(await execute(sceneCode));
  await call(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code: 42 } }, 400);
  const error = await execute('throw new Error("Expected scene smoke failure");');
  assert.equal(error.ok, false);
  assert.match(error.error, /Expected scene smoke failure/);
  const syntax = await execute('const = ;');
  assert.equal(syntax.ok, false);
  assert.equal(typeof syntax.error, 'string');
  const start = Date.now();
  const timeout = await execute('while (true) {}');
  assert.equal(timeout.ok, false);
  assert.match(timeout.error, /timed?\s*out|timeout|time limit|execution limit|five-second limit/i);
  assert(Date.now() - start < 12000, 'Infinite-loop termination exceeded the plugin execution bound.');
  const recovered = await execute(recoveryCode);
  assert.equal(recovered.ok, true, recovered.error);
  assert(recovered.logs.includes('recovered'));
  assert(descendants(recovered.scene.object).some(object => object.type === 'Mesh'));
  console.log('Verified real geometry, materials, lights, camera, animation and logs; code errors and infinite loops recover on the next execution.');
}
async function lifecycle() {
  const running = (await data('/plugins')).plugins[0];
  await stopEngine();
  await assert.rejects(fetch(running.endpoint + '/manifest', { signal: AbortSignal.timeout(1000) }));
  await startEngine();
  await until(() => data('/plugins'), value => value.plugins[0]?.runtimeStatus === 'running', 'package restoration');
  assertScene(await execute(sceneCode));
  const restored = (await data('/plugins')).plugins[0];
  const disabled = await data(pluginPath, 'PATCH', { enabled: false });
  assert.equal(disabled.runtimeStatus, 'stopped');
  await assert.rejects(fetch(restored.endpoint + '/manifest', { signal: AbortSignal.timeout(1000) }));
  await call(`${pluginPath}/actions/scene.execute`, 'POST', { input: { code: sceneCode } }, 409);
  assert.equal((await data(pluginPath, 'PATCH', { enabled: true })).runtimeStatus, 'running');
  assert.equal((await execute(recoveryCode)).ok, true);
  await call(pluginPath, 'DELETE');
  assert.deepEqual((await data('/plugins')).plugins, []);
  assert.deepEqual(await readdir(packageRoot), []);
  console.log('Verified engine restart restoration, disabled execution, re-enable, and complete package removal.');
}
try {
  await startEngine();
  await setupAndInstall();
  await executionAndRecovery();
  await lifecycle();
  console.log('Three.js package smoke passed: bundled runtime with empty PATH, authenticated execution, real scenes, bounded failures, restart, disable, and removal.');
} finally {
  await stopEngine();
  await rm(directory, { recursive: true, force: true });
}
