import { threeAssert, threeList, threeNumbers, threeObject } from "./three-plugin.ts";

const sizes: Record<string, number[]> = { position: [3], normal: [3], uv: [2], color: [3, 4], tangent: [4] };
function attribute(value: unknown, name: string): number {
  const attr = threeObject(value);
  threeAssert(sizes[name]?.includes(Number(attr.itemSize)), "Unsupported geometry attribute.");
  threeAssert(attr.type === "Float32Array" && !attr.isInterleavedBufferAttribute, "Use plain Float32 buffer attributes.");
  const array = threeList(attr.array, 32000);
  threeNumbers(array, array.length);
  const count = array.length / Number(attr.itemSize);
  threeAssert(Number.isInteger(count) && count <= 8000, "Geometry attributes exceed 8,000 vertices.");
  return count;
}
function indices(value: unknown, count: number): number {
  if (value === undefined) return count;
  const index = threeObject(value);
  threeAssert(["Uint16Array", "Uint32Array"].includes(String(index.type)), "Use unsigned geometry indices.");
  const array = threeList(index.array, 48000);
  threeAssert(array.every(item => typeof item === "number" && Number.isInteger(item) && item >= 0 && item < count), "Geometry index is outside its vertex range.");
  return array.length;
}
function groups(value: unknown, count: number) {
  for (const valueGroup of threeList(value ?? [], 256)) {
    const group = threeObject(valueGroup);
    const nums = threeNumbers([group.start, group.count, group.materialIndex], 3);
    threeAssert(nums.every(Number.isInteger) && nums.every(item => item >= 0), "Invalid geometry group.");
    threeAssert(nums[0] + nums[1] <= count && nums[2] < 16, "Geometry group is outside its draw range.");
  }
}
function restrictedData(data: Record<string, unknown>) {
  for (const key of ["morphAttributes", "morphTargetsRelative", "interleavedBuffers", "arrayBuffers", "drawcalls", "offsets"]) {
    if (data[key] !== undefined) threeAssert(JSON.stringify(data[key]) === "{}" || data[key] === false, "Instanced, interleaved and morph geometry is unsupported.");
  }
  if (data.boundingSphere === undefined) return;
  const sphere = threeObject(data.boundingSphere);
  threeNumbers(sphere.center, 3);
  threeAssert(typeof sphere.radius === "number" && sphere.radius >= 0 && sphere.radius <= 1_000_000, "Invalid bounding sphere.");
}
export function validateThreeGeometry(value: unknown): number {
  const geometry = threeObject(value);
  threeAssert(geometry.type === "BufferGeometry" && !geometry.isInstancedBufferGeometry, "Convert geometry to plain BufferGeometry before returning it.");
  threeAssert(typeof geometry.uuid === "string", "Geometry needs an identifier.");
  const data = threeObject(geometry.data);
  restrictedData(data);
  const attributes = threeObject(data.attributes);
  const count = attribute(attributes.position, "position");
  for (const [name, attr] of Object.entries(attributes)) {
    threeAssert(attribute(attr, name) === count, "Geometry attributes must have matching vertex counts.");
  }
  groups(data.groups, indices(data.index, count));
  return count;
}
