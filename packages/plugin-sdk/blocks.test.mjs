import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "./index.mjs";
const action = { name: "scene.run", title: "Run", description: "", inputSchema: { type: "object" }, outputSchema: { type: "object" }, http:{method:"POST",path:"/run",reader:false} };
const block = { id: "scene", title: "Scene", entry: "ui/scene.html", defaultSource: "{}", actions: ["scene.run"], reader: true };
const manifest = blocks => ({ apiVersion: "margin.plugin/v1", id: "custom-block", name: "Custom", version: "1", description: "", capabilities: [], actions: [action], blocks });
test("block manifests keep UI and scoped actions in one contract", () => {
  assert.deepEqual(validateManifest(manifest([block])).blocks, [block]);
  assert.doesNotThrow(() => validateManifest(manifest([{ ...block, actions: [] }])));
  assert.throws(() => validateManifest(manifest([block, block])), /Duplicate block/);
  assert.throws(() => validateManifest(manifest([{ ...block, languages: ["ipynb"] }])), /unsupported/);
});
test("block manifests reject unsafe paths, undeclared actions and unbounded defaults", () => {
  for (const entry of ["../scene.html", "/scene.html", "ui//scene.html", "https://site/ui.html", "ui\\scene.html", "ui/scene.js"]) {
    assert.throws(() => validateManifest(manifest([{ ...block, entry }])), /packaged .html/);
  }
  for (const patch of [{ actions: ["secret.run"] }, { actions: ["scene.run", "scene.run"] }, { reader: "yes" }, { defaultSource: "x".repeat(48001) }, { id: "bad:id" }, { script: "evil" }]) {
    assert.throws(() => validateManifest(manifest([{ ...block, ...patch }])));
  }
});
