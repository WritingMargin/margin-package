import { parseThreeExecution } from "./three-plugin.ts";
/** A snapshot belongs to its exact code; editing code deliberately drops it. */
export function readSource(source) {
  if (typeof source !== "string") throw new Error("The scene block source must be text.");
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || typeof value.code !== "string") throw new Error("The scene block needs a code string.");
  if (value.code.length > 48000) throw new Error("Three.js code exceeds 48,000 characters.");
  if (value.scene === undefined) return { code: value.code };
  const scene = parseThreeExecution(value.scene);
  if (!scene.ok) throw new Error("Only a successful scene can be saved in this block.");
  return { code: value.code, scene };
}
export function writeSource(code, scene) {
  if (typeof code !== "string" || code.length > 48000) throw new Error("Three.js code must be at most 48,000 characters.");
  if (!scene) return JSON.stringify({ code });
  const parsed = parseThreeExecution(scene);
  if (!parsed.ok) throw new Error("Run the scene successfully before saving it.");
  return JSON.stringify({ code, scene: parsed });
}
export function stageCode(client, code) {
  if (client.context.mode === "edit") client.change(writeSource(code));
}
export function stageScene(client, code, scene) {
  if (client.context.mode !== "edit") throw new Error("Scenes can only be saved while editing the block.");
  client.change(writeSource(code, scene));
}
