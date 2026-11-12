import test from "node:test";
import assert from "node:assert/strict";
import {
  executionAvailable,
  executionHint,
  connectionHint,
} from "./lib/connection.mjs";
const actions = [
  "session.create",
  "cell.execute",
  "session.interrupt",
  "session.restart",
  "session.heartbeat",
  "session.close",
];
test("unconfigured notebooks cannot run and explain service setup in edit or preview", () => {
  for (const mode of ["edit", "preview"]) {
    assert.equal(executionAvailable({ mode, actions: [] }), false);
    assert.equal(executionHint({ mode, actions: [] }), connectionHint);
  }
  assert.equal(
    executionAvailable({ mode: "edit", actions: ["cell.execute"] }),
    false,
  );
});
test("connected notebook execution stays available to authors while readers see saved outputs only", () => {
  for (const mode of ["edit", "preview"])
    assert.equal(executionAvailable({ mode, actions }), true);
  assert.equal(executionAvailable({ mode: "read", actions }), false);
  assert.equal(executionHint({ mode: "read", actions }), "");
  assert.match(executionHint({ mode: "edit", actions }), /Save outputs/);
});
