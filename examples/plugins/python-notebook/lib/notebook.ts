// Render only inert notebook output. Preserve the original JSON for download.
export type NotebookOutput = {
  text?: unknown;
  data?: Record<string, unknown>;
  traceback?: unknown;
};
export type NotebookCell = {
  cell_type: string;
  source: string | string[];
  outputs?: NotebookOutput[];
};
export interface Notebook {
  nbformat: number;
  cells: NotebookCell[];
}
export function notebookText(value: unknown) {
  return typeof value === "string"
    ? value
    : Array.isArray(value) && value.every((x) => typeof x === "string")
      ? value.join("")
      : "";
}
export function parseNotebook(source: string): Notebook {
  if (source.length > 1_500_000)
    throw new Error(
      "Use a notebook under 1.5 MB. Clear large outputs before embedding it.",
    );
  const notebook = JSON.parse(source);
  if (
    notebook?.nbformat !== 4 ||
    !Array.isArray(notebook.cells) ||
    !notebook.cells.every(
      (c: NotebookCell) =>
        c &&
        ["code", "markdown", "raw"].includes(c.cell_type) &&
        (typeof c.source === "string" ||
          (Array.isArray(c.source) &&
            c.source.every((s) => typeof s === "string"))) &&
        (c.outputs === undefined ||
          (Array.isArray(c.outputs) &&
            c.outputs.every((o) => o && typeof o === "object"))),
    )
  ) {
    throw new Error("Choose a valid Jupyter version 4 notebook.");
  }
  return notebook;
}
export function notebookBlock(source: string) {
  const notebook = parseNotebook(source);
  return "\n\n```ipynb\n" + JSON.stringify(notebook) + "\n```\n\n";
}
/** Terminal formatting is display-only; never rewrite imported notebook JSON. */
export function stripNotebookTerminalControls(text: string): string {
  return (
    text
      // OSC titles/hyperlinks end at BEL or ST; other control strings use ST.
      .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, "")
      .replace(
        /(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)/g,
        "",
      )
      // CSI includes SGR colours, cursor movement and terminal erase commands.
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*$/g, "")
      .replace(/\x1b[ -/]*[0-~]/g, "")
      // Keep ordinary line breaks and tabs, remove remaining control characters.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
  );
}
export function notebookOutputText(output: NotebookOutput): string {
  const traceback =
    Array.isArray(output.traceback) &&
    output.traceback.every((line) => typeof line === "string")
      ? output.traceback.join("\n")
      : notebookText(output.traceback);
  return stripNotebookTerminalControls(
    notebookText(output.text) ||
      notebookText(output.data?.["text/plain"]) ||
      traceback,
  );
}
