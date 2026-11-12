import { parseNotebook, notebookText } from "./notebook.ts";
export function emptyNotebook() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python" },
    },
    cells: [newCell("code")],
  };
}
export function newCell(type) {
  const cell = {
    cell_type: type,
    id: globalThis.crypto.randomUUID().slice(0, 8),
    metadata: {},
    source: "",
  };
  if (type === "code")
    Object.assign(cell, { outputs: [], execution_count: null });
  return cell;
}
export function serialize(book) {
  const source = JSON.stringify(book);
  parseNotebook(source);
  if (new TextEncoder().encode(source).length > 1500000)
    throw new Error(
      "Keep the notebook below 1.5 MB. Clear large outputs first.",
    );
  return source;
}
export function clearOutputs(book) {
  for (const cell of book.cells)
    if (cell.cell_type === "code") {
      cell.outputs = [];
      cell.execution_count = null;
    }
}
export function editCell(book, index, source) {
  book.cells[index].source = source;
  if (book.cells[index].cell_type === "code") clearOutputs(book);
}
export function changeType(book, index, type) {
  const cell = book.cells[index];
  const affectsCode = cell.cell_type === "code" || type === "code";
  cell.cell_type = type;
  if (type === "code")
    Object.assign(cell, { outputs: [], execution_count: null });
  else {
    delete cell.outputs;
    delete cell.execution_count;
  }
  if (affectsCode) clearOutputs(book);
}
export function moveCell(book, index, direction) {
  const next = index + direction;
  if (next < 0 || next >= book.cells.length) return;
  const affectsCode =
    book.cells[index].cell_type === "code" &&
    book.cells[next].cell_type === "code";
  [book.cells[index], book.cells[next]] = [book.cells[next], book.cells[index]];
  if (affectsCode) clearOutputs(book);
}
export function withResults(book, results) {
  const copy = structuredClone(book);
  for (const [index, result] of results) {
    const cell = copy.cells[index];
    if (cell?.cell_type === "code") {
      cell.outputs = structuredClone(result.outputs);
      cell.execution_count = result.executionCount;
    }
  }
  return copy;
}
export function codeCells(book, index) {
  return book.cells.flatMap((cell, at) =>
    cell.cell_type === "code" && (index === undefined || index === at)
      ? [{ index: at, code: notebookText(cell.source) }]
      : [],
  );
}
export function stage(client, book) {
  if (client.context.mode !== "edit")
    throw new Error("Notebook changes are only available while editing.");
  client.change(serialize(book));
}
