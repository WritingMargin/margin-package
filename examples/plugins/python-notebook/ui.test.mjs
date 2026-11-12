import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { parseNotebook } from "./lib/notebook.ts";
import {
  editCell,
  moveCell,
  withResults,
  stage,
  serialize,
  changeType,
} from "./lib/model.mjs";
import { pngData } from "./lib/render.mjs";
import { inlineNotebook } from "./build-ui.mjs";
function fixture() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { custom: { untouched: [1, 2] } },
    unknown: "preserve",
    cells: [
      {
        cell_type: "code",
        source: ["x=1\n"],
        metadata: { tags: ["keep"] },
        custom: "cell",
        execution_count: 1,
        outputs: [
          {
            output_type: "display_data",
            data: {
              "text/html": "<script>unsafe()</script>",
              "application/custom": { opaque: true },
            },
            metadata: { custom: true },
          },
        ],
      },
      {
        cell_type: "markdown",
        source: "# Hello",
        metadata: {},
        attachments: { image: { "image/png": "abc" } },
      },
    ],
  };
}
test("import/export round trip preserves unknown fields, metadata, attachments and unsupported outputs", () => {
  const book = fixture();
  assert.deepEqual(parseNotebook(serialize(book)), book);
  const updated = withResults(
    book,
    new Map([[0, { outputs: [{ text: "2" }], executionCount: 2 }]]),
  );
  assert.deepEqual(updated.metadata, book.metadata);
  assert.equal(updated.unknown, "preserve");
  assert.equal(updated.cells[0].custom, "cell");
  assert.deepEqual(updated.cells[1].attachments, book.cells[1].attachments);
  assert.equal(book.cells[0].execution_count, 1);
});
test("cell edits and reordering clear stale outputs while preserving metadata", () => {
  const book = fixture();
  editCell(book, 0, "x=2");
  assert.deepEqual(book.cells[0].outputs, []);
  assert.equal(book.cells[0].execution_count, null);
  assert.deepEqual(book.cells[0].metadata.tags, ["keep"]);
  moveCell(book, 0, 1);
  assert.equal(book.cells[1].source, "x=2");
  changeType(book, 1, "raw");
  assert.equal(book.cells[1].custom, "cell");
  assert.equal(book.cells[1].outputs, undefined);
});
test("reader and preview modes cannot persist notebook data", () => {
  for (const mode of ["read", "preview"])
    assert.throws(
      () =>
        stage(
          {
            context: { mode },
            change() {
              assert.fail();
            },
          },
          fixture(),
        ),
      /only.*editing/,
    );
  let changed;
  stage(
    {
      context: { mode: "edit" },
      change(value) {
        changed = value;
      },
    },
    fixture(),
  );
  assert.deepEqual(JSON.parse(changed), fixture());
});
test("PNG display accepts only base64 content; HTML output remains inert data", () => {
  assert.equal(pngData({ data: { "image/png": "YWJj\n" } }), "YWJj");
  assert.equal(pngData({ data: { "image/png": "<svg onload=alert(1)>" } }), "");
  assert.equal(
    pngData({ data: { "text/html": "<script>bad()</script>" } }),
    "",
  );
});
test("inline UI preserves dollar sequences and syntax-checks without execution", () => {
  const template = "<html><head></head><body></body></html>";
  const script = 'const values=["$&","$\'","$`","$$","</script>"];';
  const html = inlineNotebook(template, script, "/* $& $` */");
  const extracted = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(extracted, script.replace(/<\/script/gi, "<\\/script"));
  assert.doesNotThrow(() => new vm.Script(extracted));
  assert.throws(
    () => inlineNotebook(template, "const x=<oops>", ""),
    SyntaxError,
  );
});
test("Markdown and output rendering creates inert text nodes instead of HTML", async () => {
  const previous = globalThis.document;
  class Node {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.textContent = "";
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
  }
  globalThis.document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => ({ tag: "#text", textContent: text }),
  };
  try {
    const { markdown, outputView } = await import("./lib/render.mjs");
    const tree = markdown(
      "# Heading\n<script>alert(1)</script>\n```html\n<img onerror=alert(1)>\n```",
    );
    const tags = [];
    function walk(node) {
      tags.push(node.tag);
      for (const child of node.children || []) walk(child);
    }
    walk(tree);
    assert.deepEqual(tags, ["div", "h1", "p", "pre", "#text"]);
    assert.equal(tree.children[1].textContent, "<script>alert(1)</script>");
    const output = outputView(
      [
        {
          data: {
            "text/html": "<script>bad()</script>",
            "text/plain": "<b>literal</b>",
          },
        },
      ],
      1,
    );
    assert.equal(output.children[0].tag, "pre");
    assert.equal(output.children[0].textContent, "<b>literal</b>");
  } finally {
    globalThis.document = previous;
  }
});
test("Markdown and raw edits preserve code outputs and unknown metadata", () => {
  const book = fixture();
  const before = structuredClone(book.cells[0]);
  editCell(book, 1, "# Updated explanation");
  assert.deepEqual(book.cells[0], before);
  changeType(book, 1, "raw");
  assert.deepEqual(book.cells[0], before);
  moveCell(book, 1, -1);
  assert.deepEqual(book.cells[1], before);
  assert.deepEqual(book.metadata, { custom: { untouched: [1, 2] } });
});
test("host file import validates before replacing notebook state and preserves metadata", async () => {
  const { importNotebook } = await import("./lib/import.mjs");
  const original = fixture();
  let options;
  const imported = await importNotebook({
    async importTextFile(value) {
      options = value;
      return { name: "research.ipynb", text: JSON.stringify(original) };
    },
  });
  assert.deepEqual(options, {
    accept: ".ipynb,application/json",
    maxBytes: 1500000,
  });
  assert.deepEqual(imported, original);
  assert.equal(
    await importNotebook({
      async importTextFile() {
        return null;
      },
    }),
    null,
  );
  await assert.rejects(
    importNotebook({
      async importTextFile() {
        return { name: "bad.ipynb", text: '{"nbformat":3,"cells":[]}' };
      },
    }),
    /valid Jupyter/,
  );
  assert.deepEqual(
    original,
    fixture(),
    "invalid or cancelled import must not mutate the existing notebook",
  );
});
