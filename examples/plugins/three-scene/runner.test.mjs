import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { executeScene, activeWorkerCount, stopWorkers } from "./runner.mjs";
const signal = () => new AbortController().signal;
const boxCode = `
const mesh = new THREE.Mesh(new THREE.BoxGeometry(2,3,4), new THREE.MeshStandardMaterial({color:0x44aa88}));
mesh.name="sample";
scene.add(mesh);
scene.add(new THREE.AmbientLight(0xffffff,2));
camera.position.set(5,4,6); target.set(0,1,0);
animations.push(new THREE.AnimationClip("Spin",2,[new THREE.NumberKeyframeTrack("sample.rotation[y]",[0,2],[0,Math.PI*2])]));
console.log("THREE revision",THREE.REVISION);
`;
test("real Three.js builds geometry, materials, lights, camera and animation data", async () => {
  const result = await executeScene(boxCode, signal());
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.camera, { position: [5,4,6], target: [0,1,0], fov: 50 });
  assert.match(result.logs[0], /THREE revision/);
  const scene = new THREE.ObjectLoader().parse(result.scene);
  const mesh = scene.getObjectByName("sample");
  assert.equal(mesh.geometry.type, "BufferGeometry");
  mesh.geometry.computeBoundingBox();
  assert.deepEqual(mesh.geometry.boundingBox.getSize(new THREE.Vector3()).toArray(), [2,3,4]);
  assert.equal(mesh.material.color.getHex(), 0x44aa88);
  assert.equal(THREE.AnimationClip.parse(result.animations[0]).tracks[0].name, "sample.rotation[y]");
  assert.equal(activeWorkerCount(), 0);
});
test("the documented example is executable and stays within its wire limits", async () => {
  const code = await readFile(new URL("./example.threejs", import.meta.url), "utf8");
  const result = await executeScene(code, signal());
  assert.equal(result.ok, true, result.error);
  assert.ok(JSON.stringify(result).length <= 220 * 1024);
  assert.equal(result.animations.length, 1);
});
test("syntax and author errors are structured and preserve bounded logs", async () => {
  for (const code of ["const = wrong", 'console.log("before"); throw new Error("Fix this line")']) {
    const result = await executeScene(code, signal());
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
  }
  const result = await executeScene('for(let i=0;i<80;i++) console.log("x".repeat(1000))', signal());
  assert.equal(result.ok, true, result.error);
  assert.equal(result.logs.length, 40);
  assert.ok(result.logs.every((line) => line.length <= 500));
});
test("browser globals, custom shaders, textures and excessive geometry are rejected", async () => {
  const codes = [
    "document.createElement('canvas')",
    "scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.ShaderMaterial()))",
    "scene.background=new THREE.Texture()",
    "scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1,120,120),new THREE.MeshBasicMaterial()))",
  ];
  for (const code of codes) assert.equal((await executeScene(code, signal())).ok, false, code);
  const globals = await executeScene('console.log(typeof process,typeof require,typeof document,typeof fetch)', signal());
  assert.equal(globals.ok, true, globals.error);
  assert.equal(globals.logs[0], "undefined undefined undefined undefined");
});
test("synchronous loops time out and the next job runs normally", async () => {
  const started = performance.now();
  const result = await executeScene("while(true) {}", signal());
  assert.equal(result.ok, false); assert.match(result.error, /two-second/);
  assert.ok(performance.now() - started < 5000);
  assert.equal((await executeScene(boxCode, signal())).ok, true);
  assert.equal(activeWorkerCount(), 0);
});
test("overall deadline and caller abort terminate workers including serialization callbacks", async () => {
  const result = await executeScene("scene.toJSON=()=>{while(true){}}", signal(), { timeoutMs: 300 });
  assert.equal(result.ok, false); assert.match(result.error, /limit/);
  const controller = new AbortController();
  const pending = executeScene("while(true){}", controller.signal);
  setTimeout(() => controller.abort(), 100);
  assert.match((await pending).error, /cancelled/);
  assert.equal(activeWorkerCount(), 0);
});
test("service shutdown terminates every outstanding scene worker", async () => {
  const pending = [executeScene("while(true){}", signal()), executeScene("while(true){}", signal())];
  await stopWorkers();
  for (const result of await Promise.all(pending)) assert.equal(result.ok, false);
  assert.equal(activeWorkerCount(), 0);
});
