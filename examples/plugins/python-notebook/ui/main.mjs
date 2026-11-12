import { connectBlock } from "../../../../packages/plugin-sdk/browser.mjs";
import { importNotebook } from "../lib/import.mjs";
import { parseNotebook, notebookText } from "../lib/notebook.ts";
import { NotebookRunner } from "../lib/notebook-runner.ts";
import {
  emptyNotebook,
  newCell,
  serialize,
  clearOutputs,
  editCell,
  changeType,
  moveCell,
  withResults,
  codeCells,
  stage,
} from "../lib/model.mjs";
import { element, markdown, outputView } from "../lib/render.mjs";
const $ = (id) => document.getElementById(id);
const state = {
  client: null,
  book: null,
  runner: null,
  results: new Map(),
  open: new Set([0]),
  busy: false,
  importing: false,
  stopped: false,
  saved: true,
  resize: null,
};
const editable = () => state.client.context.mode === "edit";
const executable = () => state.client.context.mode !== "read";
function message(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}
function fail(error) {
  message("error", error?.message || String(error));
}
function theme(tokens = {}) {
  for (const key of ["background", "foreground", "muted", "accent", "border"])
    if (typeof tokens[key] === "string")
      document.documentElement.style.setProperty(`--${key}`, tokens[key]);
  if (typeof tokens.fontFamily === "string")
    document.documentElement.style.setProperty(
      "--prose-font",
      `${tokens.fontFamily}, ui-sans-serif, system-ui, sans-serif`,
    );
}
function makeRunner() {
  return new NotebookRunner(
    `block-${crypto.randomUUID()}`,
    (name, input) => state.client.action(name, input),
    (name, input) => state.client.setCleanup(name, input),
    {
      onLeaseError: () =>
        fail(
          new Error(
            "The notebook connection was lost. The old kernel will close automatically. Run a cell or restart to begin a fresh kernel; previous variables will be lost.",
          ),
        ),
    },
  );
}
function controls() {
  $("count").textContent = `${state.book.cells.length} cells`;
  $("run-all").disabled = state.busy || codeCells(state.book).length === 0;
  $("restart").disabled = state.busy;
  $("stop").hidden = !state.busy || state.importing;
  $("save").disabled = state.busy || state.saved || state.results.size === 0;
  for (const id of ["import", "new"]) $(id).disabled = state.busy;
  for (const button of $("add").querySelectorAll("button"))
    button.disabled = state.busy;
  for (const input of $("cells").querySelectorAll("textarea,select,button"))
    input.disabled = state.busy || input.dataset.blocked === "true";
}
function button(text, action, label) {
  const node = element("button", "", text);
  node.type = "button";
  if (label) node.setAttribute("aria-label", label);
  node.addEventListener("click", action);
  return node;
}
function stageEdit(invalidateRuntime = true) {
  if (invalidateRuntime) {
    state.results.clear();
    state.saved = true;
  }
  try {
    stage(state.client, state.book);
    message("error", "");
    message(
      "status",
      "Notebook updated. Run cells and save outputs before applying the block.",
    );
  } catch (error) {
    fail(error);
  }
  controls();
}
function cellTools(cell, index) {
  const tools = element("div", "cell-tools");
  const actions = element("div", "buttons");
  if (editable()) {
    const select = element("select", "margin-select");
    select.setAttribute("aria-label", `Type of cell ${index + 1}`);
    for (const type of ["code", "markdown", "raw"]) {
      const option = element("option", "", type);
      option.value = type;
      select.append(option);
    }
    select.value = cell.cell_type;
    select.addEventListener("change", () => {
      changeType(state.book, index, select.value);
      stageEdit();
      renderCells();
    });
    tools.append(select);
    for (const [label, delta] of [
      ["Move up", -1],
      ["Move down", 1],
    ]) {
      const move = button(
        label,
        () => {
          moveCell(state.book, index, delta);
          stageEdit();
          state.open = new Set([index + delta]);
          renderCells();
        },
        `${label} cell ${index + 1}`,
      );
      if (index + delta < 0 || index + delta >= state.book.cells.length)
        move.dataset.blocked = "true";
      actions.append(move);
    }
    actions.append(
      button(
        "Delete",
        () => {
          state.book.cells.splice(index, 1);
          if (cell.cell_type === "code") clearOutputs(state.book);
          stageEdit();
          renderCells();
        },
        `Delete cell ${index + 1}`,
      ),
    );
  }
  if (cell.cell_type === "code" && executable())
    actions.append(
      button(
        "Run cell",
        () => {
          void run(index);
        },
        `Run cell ${index + 1}`,
      ),
    );
  tools.append(actions);
  return tools;
}
function sourceEditor(cell, index, title) {
  const input = element("textarea", "cell-source");
  input.value = notebookText(cell.source);
  input.spellcheck = false;
  input.setAttribute(
    "aria-label",
    `${cell.cell_type} source for cell ${index + 1}`,
  );
  input.addEventListener("input", () => {
    editCell(state.book, index, input.value);
    stageEdit(cell.cell_type === "code");
    title.textContent =
      input.value.split("\n")[0].slice(0, 100) || "Empty cell";
    if (cell.cell_type === "code") {
      for (const output of $("cells").querySelectorAll(".outputs"))
        output.replaceChildren();
      for (const count of $("cells").querySelectorAll(".execution-count"))
        count.textContent = "";
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = input.selectionStart,
      end = input.selectionEnd;
    input.setRangeText("    ", start, end, "end");
    input.dispatchEvent(new Event("input"));
  });
  return input;
}
function cellView(cell, index) {
  const wrapper = element("details", "cell");
  wrapper.open = state.open.has(index) || state.client.context.mode === "read";
  wrapper.addEventListener("toggle", () => {
    if (wrapper.open) state.open.add(index);
    else state.open.delete(index);
  });
  const summary = element("summary");
  const title = element(
    "span",
    "cell-title",
    notebookText(cell.source).split("\n")[0].slice(0, 100) || "Empty cell",
  );
  const result = state.results.get(index);
  const count = result?.executionCount ?? cell.execution_count;
  summary.append(
    element("span", "number", String(index + 1).padStart(2, "0")),
    element("span", "cell-type", cell.cell_type),
    title,
    element(
      "span",
      "execution-count",
      typeof count === "number" ? `[${count}]` : "",
    ),
  );
  const body = element("div", "cell-body");
  if (executable()) body.append(cellTools(cell, index));
  if (editable()) body.append(sourceEditor(cell, index, title));
  else if (cell.cell_type === "markdown")
    body.append(markdown(notebookText(cell.source)));
  else body.append(element("pre", "source-display", notebookText(cell.source)));
  if (cell.cell_type === "code")
    body.append(outputView(result?.outputs ?? cell.outputs, index + 1));
  wrapper.append(summary, body);
  return wrapper;
}
function renderCells() {
  $("cells").replaceChildren();
  if (!state.book.cells.length)
    $("cells").append(element("p", "empty", "This notebook has no cells yet."));
  state.book.cells.forEach((cell, index) =>
    $("cells").append(cellView(cell, index)),
  );
  controls();
}
async function run(index) {
  if (state.busy || !executable()) return;
  state.busy = true;
  state.stopped = false;
  message("error", "");
  message("status", "Running Python…");
  controls();
  try {
    await state.runner.run(codeCells(state.book, index), (at, result) => {
      state.results.set(at, result);
      state.saved = false;
      state.open.add(at);
      renderCells();
    });
    const suffix = editable()
      ? " Choose Save outputs to include these results."
      : " These results are temporary.";
    message(
      "status",
      state.stopped ? "Execution stopped." : "Execution finished." + suffix,
    );
  } catch (error) {
    fail(error);
    message("status", "");
  } finally {
    state.busy = false;
    controls();
  }
}
async function stop() {
  if (!state.busy) return;
  state.stopped = true;
  try {
    await state.runner.interrupt();
    message("status", "Stopping execution…");
  } catch (error) {
    fail(error);
  }
}
async function restart() {
  if (state.busy) return;
  state.busy = true;
  controls();
  try {
    await state.runner.restart();
    state.results.clear();
    state.saved = true;
    message(
      "status",
      "Kernel restarted. Variables were cleared; saved notebook outputs are unchanged.",
    );
    renderCells();
  } catch (error) {
    fail(error);
  } finally {
    state.busy = false;
    controls();
  }
}
function saveOutputs() {
  if (!editable() || state.busy) return;
  try {
    const updated = withResults(state.book, state.results);
    stage(state.client, updated);
    state.book = updated;
    state.saved = true;
    message(
      "status",
      "Outputs included. Choose Insert or Apply in Margin to save this block.",
    );
    controls();
  } catch (error) {
    fail(error);
  }
}
async function replaceNotebook(book) {
  if (state.busy) return;
  state.busy = true;
  controls();
  try {
    await state.runner.close();
    state.runner = makeRunner();
    stage(state.client, book);
    state.book = book;
    state.results.clear();
    state.saved = true;
    state.open = new Set([0]);
    message("error", "");
    message(
      "status",
      "Notebook loaded. Its metadata and saved outputs are preserved.",
    );
  } catch (error) {
    fail(error);
  } finally {
    state.busy = false;
    renderCells();
  }
}
async function importFile() {
  if (state.busy || !editable()) return;
  state.busy = true;
  state.importing = true;
  controls();
  message("error", "");
  message("status", "Choose a notebook using the file picker in Margin.");
  let book;
  try {
    book = await importNotebook(state.client);
    if (!book)
      message("status", "Import cancelled. Your notebook is unchanged.");
  } catch (error) {
    fail(error);
  } finally {
    state.busy = false;
    state.importing = false;
    controls();
  }
  if (book) await replaceNotebook(book);
}
async function exportFile() {
  try {
    await state.client.download(
      "notebook.ipynb",
      "application/x-ipynb+json",
      serialize(state.book),
    );
    message(
      "status",
      "Choose Download notebook.ipynb in Margin to save the file. Unsaved preview results are not included.",
    );
  } catch (error) {
    fail(error);
  }
}
function bindControls() {
  $("run-all").addEventListener("click", () => {
    void run();
  });
  $("stop").addEventListener("click", () => {
    void stop();
  });
  $("restart").addEventListener("click", () => {
    void restart();
  });
  $("save").addEventListener("click", saveOutputs);
  $("import").addEventListener("click", () => {
    void importFile();
  });
  $("new").addEventListener("click", () => {
    void replaceNotebook(emptyNotebook());
  });
  $("export").addEventListener("click", () => {
    void exportFile();
  });
  for (const control of $("add").querySelectorAll("button"))
    control.addEventListener("click", () => {
      if (state.busy) return;
      state.book.cells.push(newCell(control.dataset.add));
      if (control.dataset.add === "code") clearOutputs(state.book);
      stageEdit();
      state.open.add(state.book.cells.length - 1);
      renderCells();
    });
}
function configureMode() {
  const mode = state.client.context.mode;
  $("mode").textContent = {
    edit: "Editing",
    preview: "Author preview",
    read: "Saved notebook",
  }[mode];
  for (const id of ["import", "new", "save", "add"]) $(id).hidden = !editable();
  $("execution").hidden = !executable();
  $("execution-hint").textContent = editable()
    ? "Runs are temporary until you choose Save outputs."
    : "Private Python execution. Saved notebook data is unchanged.";
}
function observeHeight() {
  let frame = 0;
  state.resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() =>
      state.client.resize(
        Math.ceil($("app").getBoundingClientRect().height + 2),
      ),
    );
  });
  state.resize.observe($("app"));
}
async function boot() {
  state.client = await connectBlock();
  theme(state.client.context.theme);
  configureMode();
  state.book = parseNotebook(state.client.context.source);
  if (executable()) state.runner = makeRunner();
  bindControls();
  renderCells();
  observeHeight();
  message(
    "status",
    executable()
      ? "Python runs in your installed notebook plugin. Your source stays yours."
      : "",
  );
  window.addEventListener(
    "pagehide",
    () => {
      state.resize?.disconnect();
      state.runner?.dispose();
      state.client.close();
    },
    { once: true },
  );
}
void boot().catch((error) => {
  message("status", "");
  fail(error);
});
