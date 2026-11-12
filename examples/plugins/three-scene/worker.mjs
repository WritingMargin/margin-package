import * as THREE from "three";
import { parseThreeExecution } from "./lib/three-plugin.ts";
const materials = new Set(["MeshStandardMaterial", "MeshPhysicalMaterial", "MeshPhongMaterial", "MeshLambertMaterial", "MeshBasicMaterial", "MeshNormalMaterial", "MeshDepthMaterial", "LineBasicMaterial", "PointsMaterial"]);
function logValue(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); }
  catch { return String(value); }
}
function validateMaterial(material) {
  if (!materials.has(material.type)) throw new Error(`Unsupported material ${material.type}. Use a standard material without textures or shaders.`);
  if (Object.values(material).some((value) => value?.isTexture)) throw new Error("Textures and external assets are not supported.");
}
function normalizeGeometry(object) {
  const source = object.geometry;
  if (!source) return;
  if (!source.isBufferGeometry) throw new Error("Only BufferGeometry-based geometries are supported.");
  if (Object.values(source.morphAttributes).some((values) => values.length)) throw new Error("Morph targets are not supported.");
  const geometry = new THREE.BufferGeometry().copy(source);
  geometry.uuid = source.uuid;
  object.geometry = geometry;
}
function normalizeScene(scene) {
  if (scene.background?.isTexture || scene.environment) throw new Error("Texture backgrounds and environments are not supported.");
  let count = 0;
  scene.traverse((object) => {
    if (++count > 128) throw new Error("Scene exceeds the 128-object limit.");
    if (object.skeleton || object.isSkinnedMesh) throw new Error("Skinned meshes are not supported.");
    if (object.animations.length) throw new Error("Add clips to the provided animations array, not to scene objects.");
    for (const material of [object.material].flat().filter(Boolean)) validateMaterial(material);
    normalizeGeometry(object);
  });
  scene.updateMatrixWorld(true);
}
function snapshot(scene, camera, target, animations, logs) {
  normalizeScene(scene);
  if (animations.length > 8) throw new Error("Use at most eight animation clips.");
  const output = {
    ok: true, scene: scene.toJSON(),
    camera: { position: camera.position.toArray(), target: target.toArray(), fov: camera.fov },
    animations: animations.map((clip) => THREE.AnimationClip.toJSON(clip)), logs,
  };
  if (new TextEncoder().encode(JSON.stringify(output)).length > 220 * 1024) throw new Error("Scene output exceeds 220 KiB. Reduce geometry detail or object count.");
  return parseThreeExecution(output);
}
function execute(code) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  camera.position.set(4, 3, 6);
  const target = new THREE.Vector3();
  const animations = [];
  const logs = [];
  const log = (...values) => { if (logs.length < 40) logs.push(values.map(logValue).join(" ").slice(0, 500)); };
  try {
    new Function("THREE", "scene", "camera", "target", "animations", "console", `"use strict";\n${code}`)(THREE, scene, camera, target, animations, Object.freeze({log, info:log, warn:log, error:log}));
    return snapshot(scene, camera, target, animations, logs);
  } catch (error) {
    const message = error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "Three.js code exceeded its two-second execution limit." : String(error?.message ?? error);
    return { ok: false, logs, error: message.slice(0, 2000) };
  }
}
// The opaque iframe CSP blocks network access; remove network/worker entry points
// as defense in depth. This is browser isolation, never server code execution.
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker", "indexedDB", "caches", "process", "require"]) {
  try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch { /* The browser may already make it unavailable. */ }
}
self.onmessage = event => self.postMessage(execute(event.data.code));
