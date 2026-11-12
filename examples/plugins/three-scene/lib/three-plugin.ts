import { validateThreeGeometry } from "./three-plugin-geometry.ts";
import { validateThreeAnimations } from "./three-plugin-animation.ts";

export type ThreeJSON = Record<string, unknown>;
export interface ThreeCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}
export interface ThreeExecution {
  ok: boolean;
  scene?: ThreeJSON;
  camera?: ThreeCamera;
  animations?: ThreeJSON[];
  logs: string[];
  error?: string;
}
const materialTypes = new Set([
  "MeshStandardMaterial", "MeshPhysicalMaterial", "MeshPhongMaterial",
  "MeshLambertMaterial", "MeshBasicMaterial", "MeshNormalMaterial",
  "MeshDepthMaterial", "LineBasicMaterial", "PointsMaterial",
]);
const objectTypes = new Set([
  "Scene", "Group", "Object3D", "Mesh", "Line", "LineSegments", "Points",
  "AmbientLight", "HemisphereLight", "DirectionalLight", "PointLight", "SpotLight",
]);
export function threeAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function threeObject(value: unknown): ThreeJSON {
  threeAssert(value && typeof value === "object" && !Array.isArray(value), "Expected a scene object.");
  return value as ThreeJSON;
}
export function threeList(value: unknown, maximum: number): unknown[] {
  threeAssert(Array.isArray(value) && value.length <= maximum, `Expected an array with at most ${maximum} entries.`);
  return value;
}
export function threeNumbers(value: unknown, length: number, limit = 1_000_000): number[] {
  const values = threeList(value, length);
  threeAssert(values.length === length && values.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= limit), "Invalid or oversized numeric scene data.");
  return values as number[];
}
function validateJSON(value: unknown, depth = 0): void {
  threeAssert(depth <= 24, "Scene data is nested too deeply.");
  if (typeof value === "number") threeAssert(Number.isFinite(value), "Scene numbers must be finite.");
  if (typeof value === "string") threeAssert(value.length <= 4096, "A scene string is too long.");
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    threeAssert(!["__proto__", "prototype", "constructor"].includes(key), "Unsupported scene property.");
    validateJSON(entry, depth + 1);
  }
}
function validateMaterial(value: unknown): string {
  const material = threeObject(value);
  threeAssert(materialTypes.has(String(material.type)), "Use a standard Three.js material; custom shaders are unsupported.");
  for (const key of Object.keys(material)) {
    threeAssert(!/map$/i.test(key) && !["uniforms", "vertexShader", "fragmentShader", "defines", "clippingPlanes"].includes(key), "Textures, custom shaders and clipping planes are unsupported.");
  }
  threeAssert(typeof material.uuid === "string", "Material needs an identifier.");
  return material.uuid;
}
function validateReferences(node: ThreeJSON, geometry: Set<string>, materials: Set<string>) {
  if (node.geometry !== undefined) threeAssert(geometry.has(String(node.geometry)), "Scene references a missing geometry.");
  if (node.material === undefined) return;
  const ids = Array.isArray(node.material) ? threeList(node.material, 16) : [node.material];
  threeAssert(ids.every(id => materials.has(String(id))), "Scene references a missing material.");
}
function validateTransforms(node: ThreeJSON) {
  if (node.matrix !== undefined) threeNumbers(node.matrix, 16);
  if (node.position !== undefined) threeNumbers(node.position, 3);
  if (node.scale !== undefined) threeNumbers(node.scale, 3);
  if (node.quaternion !== undefined) threeNumbers(node.quaternion, 4);
  if (node.rotation !== undefined) threeNumbers(node.rotation, 3);
  threeAssert(node.environment === undefined, "Environment textures are unsupported.");
  if (node.background !== undefined) threeAssert(Number.isInteger(node.background), "Use a solid scene background.");
}
function validateSceneTree(root: ThreeJSON, geometry: Set<string>, materials: Set<string>) {
  const pending: unknown[] = [root];
  const identifiers = new Set<string>();
  while (pending.length) {
    const node = threeObject(pending.pop());
    threeAssert(objectTypes.has(String(node.type)), "This scene object type is unsupported.");
    threeAssert(typeof node.uuid === "string" && !identifiers.has(node.uuid), "Scene objects need unique identifiers.");
    identifiers.add(node.uuid);
    threeAssert(identifiers.size <= 128, "Use at most 128 scene objects.");
    validateReferences(node, geometry, materials);
    validateTransforms(node);
    if (node.children !== undefined) pending.push(...threeList(node.children, 128));
  }
}
function identifiers(values: string[]): Set<string> {
  const ids = new Set(values);
  threeAssert(ids.size === values.length, "Scene resource identifiers must be unique.");
  return ids;
}
function validateScene(value: unknown): ThreeJSON {
  const scene = threeObject(value);
  for (const key of ["images", "textures", "skeletons", "animations", "shapes"]) {
    if (scene[key] !== undefined) threeAssert(threeList(scene[key], 0).length === 0, "External assets, textures and embedded animations are unsupported.");
  }
  const geometries = threeList(scene.geometries ?? [], 64);
  const geometryIDs = identifiers(geometries.map(item => String(threeObject(item).uuid)));
  const vertices = geometries.reduce<number>((sum, item) => sum + validateThreeGeometry(item), 0);
  threeAssert(vertices <= 8000, "Use at most 8,000 vertices per scene.");
  const materials = identifiers(threeList(scene.materials ?? [], 64).map(validateMaterial));
  const root = threeObject(scene.object);
  threeAssert(root.type === "Scene", "Return a Three.js Scene.");
  validateSceneTree(root, geometryIDs, materials);
  return scene;
}
function validateCamera(value: unknown): ThreeCamera {
  const camera = threeObject(value);
  const position = threeNumbers(camera.position, 3) as ThreeCamera["position"];
  const target = threeNumbers(camera.target, 3) as ThreeCamera["target"];
  threeAssert(typeof camera.fov === "number" && camera.fov >= 10 && camera.fov <= 100, "Camera field of view must be between 10 and 100 degrees.");
  threeAssert(position.some((item, index) => item !== target[index]), "Camera position and target must differ.");
  return { position, target, fov: camera.fov };
}
/** Validate again in the browser before ObjectLoader sees any plugin output. */
export function parseThreeExecution(value: unknown): ThreeExecution {
  const serialized = JSON.stringify(value);
  threeAssert(serialized && new TextEncoder().encode(serialized).length <= 220 * 1024, "Scene output exceeds 220 KiB. Use simpler geometry.");
  validateJSON(value);
  const result = threeObject(JSON.parse(serialized));
  threeAssert(typeof result.ok === "boolean", "Invalid scene execution result.");
  const logs = threeList(result.logs, 40);
  threeAssert(logs.every(line => typeof line === "string" && line.length <= 500), "Invalid scene log output.");
  if (!result.ok) {
    threeAssert(typeof result.error === "string" && result.error.length > 0 && result.error.length <= 2000, "Scene execution failed without an error message.");
    return { ok: false, logs: logs as string[], error: result.error };
  }
  return { ok: true, logs: logs as string[], scene: validateScene(result.scene), camera: validateCamera(result.camera), animations: validateThreeAnimations(result.animations ?? []) };
}
