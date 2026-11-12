import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNotebook,
  notebookBlock,
  notebookOutputText,
  stripNotebookTerminalControls,
} from "./lib/notebook.ts";
const notebook = {
  nbformat: 4,
  cells: [
    {
      cell_type: "code",
      source: ["print(1)"],
      outputs: [
        {
          data: { "text/plain": "1", "text/html": "<script>unsafe()</script>" },
        },
      ],
    },
  ],
};
test("Notebook import preserves the original cells and rejects malformed content", () => {
  const block = notebookBlock(JSON.stringify(notebook));
  assert.match(block, /^\s*```ipynb\n/);
  assert.deepEqual(parseNotebook(block.split("\n")[3]), notebook);
  assert.throws(() => parseNotebook('{"nbformat":4,"cells":[null]}'));
});
test("Jupyter coloured traceback renders as readable lines without changing notebook JSON", () => {
  const traceback = [
    "\u001b[31m---------------------------------------------------------------------------\u001b[39m",
    "\u001b[31mNameError\u001b[39m                                 Traceback (most recent call last)",
    "\u001b[36mCell\u001b[39m\u001b[36m \u001b[39m\u001b[32mIn[1]\u001b[39m\u001b[32m, line 1\u001b[39m\n\u001b[32m----> \u001b[39m\u001b[32m1\u001b[39m \u001b[43mvalue\u001b[49m",
    "\u001b[31mNameError\u001b[39m: name 'value' is not defined",
  ];
  const original = JSON.stringify({
    nbformat: 4,
    cells: [{ cell_type: "code", source: "value", outputs: [{ traceback }] }],
  });
  const parsed = parseNotebook(original);
  const text = notebookOutputText(parsed.cells[0].outputs![0]);
  assert.equal(
    text,
    "---------------------------------------------------------------------------\nNameError                                 Traceback (most recent call last)\nCell In[1], line 1\n----> 1 value\nNameError: name 'value' is not defined",
  );
  assert.equal(JSON.stringify(parsed), original);
});
test("stream and plain notebook output strip terminal commands but preserve ordinary text", () => {
  assert.equal(
    notebookOutputText({
      text: ["\u001b[32mReady\u001b[0m", "\n\t✓ Café 日本語"],
    }),
    "Ready\n\t✓ Café 日本語",
  );
  assert.equal(
    notebookOutputText({
      data: { "text/plain": "\u009b1;31mError\u009b0m\n" },
    }),
    "Error\n",
  );
  assert.equal(
    stripNotebookTerminalControls(
      "\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\\u001b[2K\r\u001b[1Gdone\u0007",
    ),
    "link\rdone",
  );
  assert.equal(
    stripNotebookTerminalControls(
      "before\u001b]0;window title\u0007after\u001b[31",
    ),
    "beforeafter",
  );
});
