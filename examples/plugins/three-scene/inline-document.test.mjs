import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { inlineDocument } from "./inline-document.mjs";
const template = '<html><head><title>Scene</title></head><body><main></main></body></html>';
test("inline packaging preserves every replacement-dollar sequence in JavaScript and CSS", () => {
  const values = ["$&", "$'", "$`", "$$", "</script>"];
  const script = `const examples = ${JSON.stringify(values)};`;
  const css = `/* ${values.slice(0, 4).join(" ")} */ body { margin: 0; }`;
  const html = inlineDocument(template, script, css);
  const extracted = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(extracted, script.replace(/<\/script/gi, "<\\/script"));
  assert.ok(html.includes(`<style>${css}</style>`));
  assert.doesNotThrow(() => new vm.Script(extracted));
  assert.equal((html.match(/<body>/g) || []).length, 1);
});
test("packaging syntax-checks the final inline script without executing it", () => {
  assert.throws(() => inlineDocument(template, "const broken = <html>", ""), SyntaxError);
  assert.doesNotThrow(() => inlineDocument(template, 'throw new Error("must not execute")', ""));
});
