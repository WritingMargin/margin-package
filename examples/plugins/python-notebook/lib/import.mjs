import { parseNotebook } from "./notebook.ts";
import { serialize } from "./model.mjs";
/** Parsing completes before any active kernel or notebook state is changed. */
export async function importNotebook(client) {
  const selected = await client.importTextFile({
    accept: ".ipynb,application/json",
    maxBytes: 1500000,
  });
  if (selected === null) return null;
  if (typeof selected?.text !== "string")
    throw new Error("Margin did not provide a notebook file.");
  const notebook = parseNotebook(selected.text);
  serialize(notebook);
  return notebook;
}
