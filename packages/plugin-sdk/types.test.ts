import { defineAction, definePlugin } from "./index.mjs";
const echo = defineAction({
  name: "text.echo", title: "Echo", description: "Echo",
  inputSchema: { type: "object", properties: { text: { type: "string" }, flag: { type: "boolean" } }, required: ["text"], additionalProperties: false },
  outputSchema: { type: "object", properties: { words: { type: "integer" } }, required: ["words"], additionalProperties: false },
  handler(input, context) {
    const text: string = input.text;
    const flag: boolean | undefined = input.flag;
    const publication: string = context.publicationId;
    // @ts-expect-error Input text is inferred as string.
    const wrong: number = input.text;
    void wrong; void flag; void publication;
    return { words: text.length };
  },
});
const second = defineAction({
  name: "other.action", title: "Other", description: "Other",
  inputSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  handler: (input) => ({ ok: input.count > 0 }),
});
definePlugin({ id: "typed", name: "Typed", version: "1", description: "", capabilities: [], actions: [echo, second] });
definePlugin({ id: "with-block", name: "Block", version: "1", description: "", capabilities: [], actions: [echo], blocks: [{ id: "card", title: "Card", entry: "ui/card.html", actions: ["text.echo"], reader: true }] });
import type { BlockAPI } from "./browser.mjs";
function blockTypes(client: BlockAPI) {
  client.change("{}");
  client.resize(320);
  client.setCleanup("session.close", { sessionId: "example" });
  client.setCleanup(null);
  client.download("notebook.ipynb", "application/x-ipynb+json", "{}");
  const imported: Promise<{ name: string; text: string } | null> = client.importTextFile({ accept: ".ipynb", maxBytes: 1500000 });
  void imported;
  const result: Promise<{ words: number }> = client.action("text.count", { text: "hello" });
  // @ts-expect-error Block source is text, not an arbitrary object.
  client.change({ text: "hello" });
  void result;
}
void blockTypes;
// @ts-expect-error Output words must match the declared numeric schema.
defineAction({
  name: "bad.action", title: "Bad", description: "Bad",
  inputSchema: { type: "object" },
  outputSchema: { type: "object", properties: { words: { type: "integer" } }, required: ["words"] },
  handler: () => ({ words: "wrong" }),
});
