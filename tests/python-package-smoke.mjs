// Opt-in real-kernel test. Supply a matching, self-contained Python package:
// node tests/python-package-smoke.mjs /path/to/python-notebook.margin-plugin
// The engine and plugin run with an empty PATH; no host Python is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 3, 'Usage: node tests/python-package-smoke.mjs /path/to/python-notebook.margin-plugin');
const archive = path.resolve(process.argv[2]);
await access(archive);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binary = path.join(root, 'artifacts/margin-server');
await access(binary);
const directory = await mkdtemp(path.join(tmpdir(), 'margin-python-package-smoke-'));
const packageRoot = path.join(directory, 'plugins');
const kernelPids = new Set();
const pluginPath = '/plugins/python-notebook';
let engine;
let base;
let cookie = '';

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, accepts, label, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
function engineEnvironment() {
  return {
    PATH: '', HOME: directory, MARGIN_ENV: 'test', SQLITE_PATH: path.join(directory, 'margin.db'),
    MARGIN_PLUGIN_DIR: packageRoot, SETUP_TOKEN: 'python-package-smoke', CONTENT_ENCRYPTION_KEY: 'ab'.repeat(32),
    AWS_SECRET_ACCESS_KEY: 'test-engine-secret-must-not-reach-the-kernel',
  };
}
async function startEngine() {
  engine = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', '0'], {
    cwd: directory, env: engineEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
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
async function call(route, method = 'GET', input, status = 200) {
  const response = await fetch(base + '/api' + route, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(35000),
  });
  assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const action = async (name, input) => (await data(`${pluginPath}/actions/${name}`, 'POST', { input })).output;
const createSession = async name => (await action('session.create', { notebookId: name })).sessionId;
const execute = (sessionId, code) => action('cell.execute', { sessionId, code });
const outputText = result => result.outputs.map(output => output.text ?? output.data?.['text/plain'] ?? '').join('');
const hasError = (result, name) => result.outputs.some(output => output.output_type === 'error' && output.ename === name);
async function fileExists(filename) {
  try { await access(filename); return true; } catch { return false; }
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function kernelStopped(pid) {
  await until(() => processAlive(pid), alive => !alive, `kernel ${pid} to stop`, 10000);
  kernelPids.delete(pid);
}
async function kernelInfo(sessionId) {
  const result = await execute(sessionId, `import json, os, sys
print("MARGIN_KERNEL_INFO=" + json.dumps({"pid": os.getpid(), "executable": sys.executable,
    "engineSecret": os.environ.get("AWS_SECRET_ACCESS_KEY"),
    "serviceToken": os.environ.get("PLUGIN_TOKEN"),
    "legacyServiceToken": os.environ.get("MARGIN_PLUGIN_TOKEN")}))`);
  const match = /MARGIN_KERNEL_INFO=(\{[^\n]+\})/.exec(outputText(result));
  assert(match, `Kernel did not return diagnostic identity: ${JSON.stringify(result)}`);
  const info = JSON.parse(match[1]);
  assert(Number.isInteger(info.pid) && info.pid > 1 && info.pid !== process.pid);
  assert(info.executable.startsWith(packageRoot + path.sep), `Kernel used an interpreter outside the package: ${info.executable}`);
  assert.equal(info.engineSecret, null);
  assert.equal(info.serviceToken, null);
  assert.equal(info.legacyServiceToken, null);
  kernelPids.add(info.pid);
  return info;
}
async function setupAndInstall() {
  await call('/plugins', 'GET', undefined, 401);
  const setup = await call('/setup', 'POST', { email: 'owner@example.com', password: 'correct horse battery', setupToken: 'python-package-smoke' }, 201);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await data('/plugins')).plugins, []);
  const host = await data('/plugins/host');
  assert.equal(host.executionSupported, true);
  const response = await fetch(base + '/api/plugins/packages', {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'Content-Length': String((await stat(archive)).size), Origin: base, Cookie: cookie },
    body: createReadStream(archive), duplex: 'half', signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 201, `Package installation: ${await response.clone().text()}`);
  const installed = await response.json();
  assert.equal(installed.id, 'python-notebook');
  assert.equal(installed.installation, 'package');
  assert.equal(installed.enabled, false);
  assert.equal(installed.version, '0.3.0');
  const notebook = installed.blocks.find(block => block.id === 'notebook');
  assert(notebook, 'Package must own its notebook interface.');
  assert.equal(notebook.entry, 'ui/notebook.html');
  assert.deepEqual(notebook.languages, ['ipynb']);
  assert.equal(notebook.reader, true);
  assert.equal(JSON.parse(notebook.defaultSource).nbformat, 4);
  assert.deepEqual([...notebook.actions].sort(), installed.actions.map(action => action.name).sort());
  await call('/plugin-blocks/python-notebook/notebook', 'GET', undefined, 404);
  await call(`${pluginPath}/actions/session.create`, 'POST', { input: { notebookId: 'disabled' } }, 409);
  const enabled = await data(pluginPath, 'PATCH', { enabled: true });
  assert.equal(enabled.runtimeStatus, 'running');
  const registry = await data('/plugin-blocks');
  assert.deepEqual(registry.blocks.find(block => block.pluginId === 'python-notebook').languages, ['ipynb']);
  const ui = await data('/plugin-blocks/python-notebook/notebook');
  assert.match(ui.html, /^<!doctype html>/i);
  assert.match(ui.html, /<script/);
  const frame = await call('/plugin-blocks/python-notebook/notebook/frame');
  assert.match(frame.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert(!frame.headers.get('content-security-policy').includes('allow-same-origin'));
  assert.equal(await frame.text(), ui.html, 'Both UI routes must serve the verified package document.');
  console.log('Installed and started the bundled Python service with an empty engine PATH.');
}
async function statefulCells(sessionId) {
  const first = await execute(sessionId, 'answer = 40\nprint("Notebook ready")');
  assert.match(outputText(first), /Notebook ready/);
  const second = await execute(sessionId, 'answer += 2\nanswer');
  assert.match(outputText(second), /42/);
  assert(second.executionCount > first.executionCount);
  const failure = await execute(sessionId, '1 / 0');
  assert(hasError(failure, 'ZeroDivisionError'), 'Python exceptions must be returned as notebook outputs.');
  const display = await execute(sessionId, `from IPython.display import display
import base64
png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
display({"image/png": png, "text/plain": "A notebook image", "text/html": "<script>ignored</script>"}, raw=True)`);
  assert(display.outputs.some(output => output.data?.['image/png']), 'PNG output was not preserved.');
  assert(display.outputs.every(output => !output.data?.['text/html']), 'Unexpected HTML output escaped the plugin filter.');
  console.log('Verified persistent variables, execution counts, stdout, expression output, PNG display, and Python errors.');
}
async function interruptAndRestart(sessionId, oldPid) {
  const marker = path.join(directory, 'cell-running');
  const pending = execute(sessionId, `from pathlib import Path
import time
Path(${JSON.stringify(marker)}).write_text("running")
time.sleep(60)`).then(output => ({ output }), error => ({ error }));
  await until(() => fileExists(marker), Boolean, 'the long-running cell to start');
  const start = Date.now();
  assert.equal((await action('session.interrupt', { sessionId })).ok, true);
  const result = await pending;
  assert.ifError(result.error);
  assert(hasError(result.output, 'KeyboardInterrupt'), 'Interrupt did not stop the active Python cell.');
  assert(Date.now() - start < 10000, 'Interrupt took too long.');
  assert.equal((await action('session.restart', { sessionId })).ok, true);
  await kernelStopped(oldPid);
  const reset = await execute(sessionId, 'answer');
  assert(hasError(reset, 'NameError'), 'Restart retained the previous notebook variables.');
  const current = await kernelInfo(sessionId);
  assert.notEqual(current.pid, oldPid);
  console.log('Interrupted a running cell and restarted its real kernel with cleared state.');
}
async function disableWithFourKernels(sessionId) {
  const sessions = [sessionId];
  for (let index = 1; index < 4; index++) {
    const next = await createSession(`parallel-${index}`);
    sessions.push(next);
    await kernelInfo(next);
  }
  assert.equal(kernelPids.size, 4);
  const pids = [...kernelPids];
  const running = (await data('/plugins')).plugins[0];
  const disabled = await data(pluginPath, 'PATCH', { enabled: false });
  assert.equal(disabled.runtimeStatus, 'stopped');
  assert.equal(disabled.enabled, false);
  await Promise.all(pids.map(kernelStopped));
  await assert.rejects(fetch(running.endpoint + '/manifest', { signal: AbortSignal.timeout(1000) }));
  await call(`${pluginPath}/actions/cell.execute`, 'POST', { input: { sessionId, code: '1' } }, 409);
  console.log('Disabled the service and confirmed all four real kernel processes exited.');
  return sessions;
}
async function reenableAndClose(oldSession) {
  const enabled = await data(pluginPath, 'PATCH', { enabled: true });
  assert.equal(enabled.runtimeStatus, 'running');
  // Service errors are intentionally sanitized by the engine as HTTP 502.
  await call(`${pluginPath}/actions/cell.execute`, 'POST', { input: { sessionId: oldSession, code: '1' } }, 502);
  const sessionId = await createSession('after-reenable');
  const info = await kernelInfo(sessionId);
  assert.match(outputText(await execute(sessionId, '6 * 7')), /42/);
  assert.equal((await action('session.close', { sessionId })).ok, true);
  await kernelStopped(info.pid);
  await call(`${pluginPath}/actions/cell.execute`, 'POST', { input: { sessionId, code: '1' } }, 502);
  console.log('Re-enabled the package, rejected expired sessions, and closed a fresh kernel cleanly.');
}
async function shutdownWithActiveKernel() {
  const sessionId = await createSession('engine-shutdown');
  const info = await kernelInfo(sessionId);
  await stopEngine();
  await kernelStopped(info.pid);
  await startEngine();
  await until(() => data('/plugins'), value => value.plugins[0]?.runtimeStatus === 'running', 'package restoration');
  const restored = await createSession('restored');
  const current = await kernelInfo(restored);
  assert.equal((await action('session.close', { sessionId: restored })).ok, true);
  await kernelStopped(current.pid);
  await call(pluginPath, 'DELETE');
  assert.deepEqual((await data('/plugins')).plugins, []);
  assert.deepEqual(await readdir(packageRoot), []);
  console.log('Engine shutdown cleaned its kernel; restart restored the package; removal cleared owned files.');
}
async function cleanup() {
  await stopEngine();
  // Only PIDs returned by kernels this fixture created are ever cleaned up.
  for (const pid of kernelPids) {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error(`Could not clean fixture kernel ${pid}: ${error.message}`); }
  }
  await rm(directory, { recursive: true, force: true });
}
try {
  await startEngine();
  await setupAndInstall();
  const sessionId = await createSession('stateful-notebook');
  await statefulCells(sessionId);
  const initial = await kernelInfo(sessionId);
  await interruptAndRestart(sessionId, initial.pid);
  await disableWithFourKernels(sessionId);
  await reenableAndClose(sessionId);
  await shutdownWithActiveKernel();
  assert.equal(kernelPids.size, 0);
  console.log('Python package smoke passed: bundled interpreter, real Jupyter kernels, state, rich output, errors, interrupt/restart, four-kernel cleanup, re-enable, session close, engine restore, and removal.');
} finally {
  await cleanup();
}
