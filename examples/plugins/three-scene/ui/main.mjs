import { executeScene } from "../runner.mjs";
import { connectBlock } from "../../../../packages/plugin-sdk/browser.mjs";
import { readSource, stageCode, stageScene } from "../lib/source.mjs";
import { parseThreeExecution } from "../lib/three-plugin.ts";
import { createThreeScene } from "./scene-runtime.ts";
const byId = (id) => document.getElementById(id);
const state = { client: null, code: "", saved: null, result: null, runtime: null, active: null, playing: false, resize: null };
function message(id, text) {
  byId(id).textContent = text;
  byId(id).hidden = !text;
}
function applyTheme(theme = {}) {
  for (const key of ["background", "foreground", "muted", "accent", "border"]) {
    if (typeof theme[key] === "string") document.documentElement.style.setProperty(`--${key}`, theme[key]);
  }
  if (typeof theme.fontFamily === "string") document.documentElement.style.setProperty("--font", theme.fontFamily);
}
function updateButtons() {
  byId("run").disabled = !!state.active;
  byId("run").textContent = state.active ? "Running…" : "Run scene";
  byId("stop").hidden = !state.active;
  byId("save").disabled = !state.result?.ok || !!state.active || state.saved === state.result;
}
function showLogs(logs) {
  byId("logs").hidden = logs.length === 0;
  byId("log-count").textContent = String(logs.length);
  byId("log-text").textContent = logs.join("\n");
}
function disposeViewer() {
  state.runtime?.dispose();
  state.runtime = null;
  state.playing = false;
  byId("result").hidden = true;
}
function setClips(animations) {
  byId("play").hidden = animations.length === 0;
  byId("play").textContent = "Play animation";
  byId("clip-label").hidden = animations.length < 2;
  byId("clip").replaceChildren();
  animations.forEach((clip, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = typeof clip.name === "string" ? clip.name : `Animation ${index + 1}`;
    byId("clip").append(option);
  });
}
function renderScene(result) {
  disposeViewer();
  if (!result?.ok) return;
  byId("result").hidden = false;
  setClips(result.animations ?? []);
  try {
    state.runtime = createThreeScene(byId("canvas"), result, (error) => {
      message("error", error);
      disposeViewer();
    });
    state.runtime.selectClip(0);
  } catch (error) {
    message("error", `This browser could not display the scene. ${error.message}`);
    disposeViewer();
  }
}
function showResult(result) {
  state.result = result;
  showLogs(result.logs);
  if (!result.ok) {
    message("status", "");
    message("error", result.error);
    return;
  }
  renderScene(result);
  const prompt = state.client.context.mode === "edit"
    ? "Scene ready. Save scene to include this result in your block."
    : "Temporary preview. The saved scene has not changed.";
  message("status", prompt);
}
function runFailed(controller, error) {
  if (!controller.signal.aborted) return message("error", error.message || "The scene could not run.");
  const changed = controller.signal.reason === "source changed";
  message("status", changed ? "Code changed. Run the updated scene." : "Scene execution stopped.");
}
async function run() {
  if (state.active || state.client.context.mode === "read") return;
  const controller = new AbortController();
  state.active = controller;
  state.result = null;
  disposeViewer();
  showLogs([]);
  message("error", "");
  message("status", "Building your scene…");
  updateButtons();
  try {
    const value = await executeScene(state.code, controller.signal);
    if (!controller.signal.aborted) showResult(parseThreeExecution(value));
  } catch (error) { runFailed(controller, error); }
  finally {
    if (state.active === controller) state.active = null;
    updateButtons();
  }
}
function codeChanged() {
  state.active?.abort("source changed");
  state.code = byId("code").value;
  state.saved = null;
  state.result = null;
  disposeViewer();
  showLogs([]);
  message("error", "");
  try {
    stageCode(state.client, state.code);
    message("status", "Code updated. Run it, then save a scene for readers.");
  } catch (error) { message("error", error.message); }
  updateButtons();
}
function saveScene() {
  if (!state.result?.ok) return;
  try {
    stageScene(state.client, state.code, state.result);
    state.saved = state.result;
    message("status", "Scene included. Choose Apply or Insert in Margin to save the block.");
  } catch (error) { message("error", error.message); }
  updateButtons();
}
function play() {
  if (!state.runtime) return;
  state.playing = !state.playing;
  state.runtime.play(state.playing);
  byId("play").textContent = state.playing ? "Pause animation" : "Play animation";
}
function selectClip() {
  state.playing = false;
  state.runtime?.play(false);
  state.runtime?.selectClip(Number(byId("clip").value));
  byId("play").textContent = "Play animation";
}
function connectControls() {
  byId("run").addEventListener("click", () => { void run(); });
  byId("stop").addEventListener("click", () => state.active?.abort("stop"));
  byId("save").addEventListener("click", saveScene);
  byId("code").addEventListener("input", codeChanged);
  byId("reset").addEventListener("click", () => state.runtime?.reset());
  byId("play").addEventListener("click", play);
  byId("clip").addEventListener("change", selectClip);
}
function configureMode(mode) {
  byId("editor").hidden = mode !== "edit";
  byId("execution").hidden = mode === "read";
  byId("save").hidden = mode !== "edit";
  byId("source").hidden = mode !== "preview";
  byId("mode").textContent = { edit: "Editing", preview: "Author preview", read: "Interactive scene" }[mode] || "";
  if (mode === "edit") byId("run-hint").textContent = "Run, explore, then save a scene for readers.";
}
function observeHeight() {
  let frame = 0;
  state.resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => state.client.resize(Math.ceil(byId("app").getBoundingClientRect().height + 2)));
  });
  state.resize.observe(byId("app"));
}
function close() {
  state.active?.abort("close");
  disposeViewer();
  state.resize?.disconnect();
  state.client?.close();
}
async function boot() {
  state.client = await connectBlock();
  const { context } = state.client;
  applyTheme(context.theme);
  configureMode(context.mode);
  const source = readSource(context.source);
  state.code = source.code;
  state.saved = source.scene ?? null;
  state.result = state.saved;
  byId("code").value = state.code;
  byId("source-text").textContent = state.code;
  connectControls();
  observeHeight();
  if (state.saved) {
    renderScene(state.saved);
    message("status", context.mode === "read" ? "" : "Showing the scene saved in this block.");
  } else {
    message("status", context.mode === "read" ? "The author has not saved a scene for this block yet." : "Run your code to explore it, then save a scene for readers.");
  }
  updateButtons();
  window.addEventListener("pagehide", close, { once: true });
}
void boot().catch((error) => {
  message("status", "");
  message("error", `Could not open the scene block. ${error.message}`);
});
