import { defineAction, definePlugin } from "@margin/plugin-sdk";
import { defaultSource } from "./default-source.mjs";
import { executeScene } from "./runner.mjs";
const vector = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
export const sceneAction = defineAction({
  name: "scene.execute",
  title: "Run Three.js code",
  description: "Build an interactive 3D scene from trusted author JavaScript. The author preview receives validated scene data.",
  inputSchema: { type: "object", properties: { code: { type: "string", maxLength: 48000 } }, required: ["code"], additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      scene: { type: "object", additionalProperties: true },
      camera: { type: "object", properties: { position: vector, target: vector, fov: { type: "number", minimum: 10, maximum: 100 } }, required: ["position", "target", "fov"], additionalProperties: false },
      animations: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: true } },
      logs: { type: "array", maxItems: 40, items: { type: "string", maxLength: 500 } },
      error: { type: "string", maxLength: 2000 },
    },
    required: ["ok", "logs"], additionalProperties: false,
  },
  handler(input, context) { return executeScene(input.code, context.signal); },
});
export default definePlugin({
  id: "three-scene", name: "Three.js scenes", version: "0.2.0",
  description: "Run Three.js author code to create interactive scenes and keyframe animations.",
  capabilities: ["scene.execute"], actions: [sceneAction],
  blocks: [{ id: "scene", title: "Three.js scene", description: "Build, save and explore an interactive scene with Three.js.", entry: "ui/scene.html", defaultSource, actions: ["scene.execute"], reader: true }],
});
