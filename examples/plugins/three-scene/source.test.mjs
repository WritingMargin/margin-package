import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readSource, writeSource, stageCode, stageScene } from "./lib/source.mjs";
import { defaultCode, defaultSource } from "./default-source.mjs";
function snapshot() {
  const scene = new THREE.Scene();
  return { ok: true, scene: scene.toJSON(), camera: { position: [4,3,6], target: [0,0,0], fov: 50 }, animations: [], logs: [] };
}
function client(mode) { const changes = []; return { context: { mode }, change(source) { changes.push(source); }, changes }; }
test("source snapshots round-trip and code edits deliberately drop the saved scene", () => {
  const saved = readSource(writeSource("scene.add(new THREE.Group())", snapshot()));
  assert.equal(saved.scene.ok, true);
  assert.equal(readSource(defaultSource).code, defaultCode);
  const edit = client("edit");
  stageScene(edit, "old code", snapshot());
  stageCode(edit, "new code");
  assert.equal(JSON.parse(edit.changes[0]).scene.ok, true);
  assert.deepEqual(JSON.parse(edit.changes[1]), { code: "new code" });
});
test("preview and reader modes cannot persist or change block data", () => {
  for (const mode of ["preview", "read"]) {
    const view = client(mode);
    stageCode(view, "changed");
    assert.throws(() => stageScene(view, "changed", snapshot()), /only.*editing/);
    assert.deepEqual(view.changes, []);
  }
});
test("invalid persisted scenes and failed executions cannot be saved", () => {
  assert.throws(() => readSource('{"code":"x","scene":{"ok":true,"logs":[]}}'));
  assert.throws(() => writeSource("x", { ok: false, error: "failed", logs: [] }), /successfully/);
  assert.throws(() => writeSource("x".repeat(48001)), /48,000/);
});
