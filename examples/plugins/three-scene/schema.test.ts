import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { parseThreeExecution } from "./lib/three-plugin.ts";

interface TestSceneJSON extends THREE.SceneJSON {
  materials: Record<string, unknown>[];
  geometries: { data: { attributes: Record<string, Record<string, unknown>>; index: { array: number[] } } }[];
}
function fixture() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f5f4ef");
  const geometry = new THREE.BufferGeometry().copy(new THREE.BoxGeometry(2, 3, 4));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#879766" }));
  mesh.name = "sample";
  scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x555555, 2));
  const clip = new THREE.AnimationClip("Turn", 2, [new THREE.NumberKeyframeTrack("sample.rotation[y]", [0, 2], [0, Math.PI * 2])]);
  return { ok: true, scene: scene.toJSON() as TestSceneJSON, camera: { position: [4, 3, 6], target: [0, 0, 0], fov: 45 }, animations: [THREE.AnimationClip.toJSON(clip)], logs: ["Created a box"] };
}
test("real Three.js geometry, material and transform animation round-trip through the plugin contract", () => {
  const original = fixture();
  const result = parseThreeExecution(original);
  const scene = new THREE.ObjectLoader().parse(result.scene!);
  const box = scene.getObjectByName("sample") as THREE.Mesh;
  const bounds = new THREE.Box3().setFromObject(box).getSize(new THREE.Vector3());
  assert.deepEqual(bounds.toArray(), [2, 3, 4]);
  assert.equal((box.material as THREE.MeshStandardMaterial).color.getHexString(), "879766");
  const clip = THREE.AnimationClip.parse(result.animations![0] as unknown as THREE.AnimationClipJSON);
  assert.equal(clip.tracks[0].name, "sample.rotation[y]");
  original.camera.position[0] = 99;
  assert.equal(result.camera!.position[0], 4, "validated result is a snapshot");
});
test("external assets and custom shaders never reach the browser loader", () => {
  const image = fixture();
  Object.assign(image.scene, { images: [{ uuid: "image", url: "https://example.com/private" }] });
  assert.throws(() => parseThreeExecution(image), /array|assets/);
  const shader = fixture();
  Object.assign(shader.scene.materials![0], { type: "ShaderMaterial", vertexShader: "void main(){}" });
  assert.throws(() => parseThreeExecution(shader), /material|shader/);
});
test("geometry constructor parameters, interleaved buffers, invalid indices and nonfinite values are refused", () => {
  const parameterized = fixture();
  Object.assign(parameterized.scene.geometries![0], { type: "SphereGeometry", widthSegments: 1_000_000 });
  assert.throws(() => parseThreeExecution(parameterized), /BufferGeometry/);
  const interleaved = fixture();
  const data = interleaved.scene.geometries![0].data!;
  Object.assign(data.attributes.position, { isInterleavedBufferAttribute: true });
  assert.throws(() => parseThreeExecution(interleaved), /Float32/);
  const invalid = fixture();
  invalid.scene.geometries![0].data!.index!.array[0] = 50000;
  assert.throws(() => parseThreeExecution(invalid), /index/);
  const nonfinite = fixture();
  nonfinite.camera.position[0] = Infinity;
  assert.throws(() => parseThreeExecution(nonfinite), /finite/);
});
test("animation bindings stay within object transforms and bounded timelines", () => {
  const unsafe = fixture();
  unsafe.animations[0].tracks[0].name = "sample.material.__proto__.color";
  assert.throws(() => parseThreeExecution(unsafe), /Animation tracks/);
  const long = fixture();
  long.animations[0].duration = 1000;
  assert.throws(() => parseThreeExecution(long), /duration/);
});
test("bounded errors are displayed as text and oversized results are rejected", () => {
  assert.deepEqual(parseThreeExecution({ ok: false, error: "SyntaxError: Unexpected token", logs: [] }), { ok: false, error: "SyntaxError: Unexpected token", logs: [] });
  const prototype = JSON.parse('{"ok":false,"logs":[],"error":"Failed","__proto__":{}}');
  assert.throws(() => parseThreeExecution(prototype), /Unsupported scene property/);
  assert.throws(() => parseThreeExecution({ ...fixture(), padding: "x".repeat(230 * 1024) }), /220 KiB/);
});
