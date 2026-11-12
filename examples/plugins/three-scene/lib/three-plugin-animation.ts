import { threeAssert, threeList, threeNumbers, threeObject, type ThreeJSON } from "./three-plugin.ts";

function trackSize(track: ThreeJSON): number {
  const binding = /^(?:[A-Za-z0-9_-]{1,80})?\.(position|quaternion|scale|rotation\[[xyz]\])$/.exec(String(track.name));
  threeAssert(binding, "Animation tracks may target object position, quaternion, scale or a rotation axis.");
  if (binding[1] === "quaternion") {
    threeAssert(track.type === "quaternion", "Quaternion animation needs a quaternion track.");
    return 4;
  }
  if (binding[1].startsWith("rotation")) {
    threeAssert(track.type === "number", "Rotation animation needs a number track.");
    return 1;
  }
  threeAssert(track.type === "vector", "Position and scale animation need vector tracks.");
  return 3;
}
function validateTrack(value: unknown) {
  const track = threeObject(value);
  const size = trackSize(track);
  const times = threeList(track.times, 600);
  threeAssert(times.length > 0, "Animation tracks need at least one keyframe.");
  const numericTimes = threeNumbers(times, times.length, 120);
  threeAssert(numericTimes.every((time, index) => time >= 0 && (index === 0 || time >= numericTimes[index - 1])), "Animation times must be ordered between 0 and 120 seconds.");
  threeNumbers(track.values, times.length * size);
  if (track.interpolation !== undefined) threeAssert([2300, 2301, 2302].includes(Number(track.interpolation)), "Unsupported animation interpolation.");
}
export function validateThreeAnimations(value: unknown): ThreeJSON[] {
  return threeList(value, 8).map(entry => {
    const clip = threeObject(entry);
    threeAssert(typeof clip.name === "string" && clip.name.length <= 100, "Animation needs a short name.");
    threeAssert(typeof clip.duration === "number" && clip.duration > 0 && clip.duration <= 120, "Animation duration must be between 0 and 120 seconds.");
    if (clip.blendMode !== undefined) threeAssert([2500, 2501].includes(Number(clip.blendMode)), "Unsupported animation blend mode.");
    threeList(clip.tracks, 32).forEach(validateTrack);
    return clip;
  });
}
