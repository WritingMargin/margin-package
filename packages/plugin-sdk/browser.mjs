const PROTOCOL = "margin.block/v1";
const SOURCE_LIMIT = 1536 * 1024;
const bytes = value => new TextEncoder().encode(value).length;

/** Connect only to Margin's parent frame; no credentials or ambient host API. */
export function connectBlock() {
  if (typeof window === "undefined" || window.parent === window) return Promise.reject(new Error("Open this block inside Margin."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Margin did not connect to this block.")), 10000);
    function finish(error, client) {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (error) reject(error); else resolve(client);
    }
    function receive(event) {
      if (event.source !== window.parent || event.data?.protocol !== PROTOCOL || event.data?.type !== "margin:init") return;
      const port = event.ports?.[0];
      if (!port) return;
      try { finish(null, new BlockClient(port, event.data.context)); }
      catch (error) { port.close(); finish(error); }
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "margin:ready", protocol: PROTOCOL }, "*");
  });
}

/** Exported for integration tests; use connectBlock() in a plugin UI. */
export class BlockClient {
  #port; #pending = new Map(); #next = 0; #closed = false; #importing = false;
  constructor(port, context) {
    if (!["edit", "preview", "read"].includes(context?.mode) || typeof context.source !== "string") throw new Error("Invalid Margin block context.");
    this.context = Object.freeze({ ...context, theme: Object.freeze({ ...context.theme }) });
    this.#port = port;
    port.onmessage = event => this.#receive(event.data);
    port.onmessageerror = () => this.close();
    port.start();
  }
  #receive(message) {
    if (message?.type !== "result" && message?.type !== "error") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    pending.cleanup();
    if (message.type === "error") pending.reject(new Error(String(message.error || "Plugin action failed.")));
    else pending.resolve(message.output);
  }
  action(action, input, { signal } = {}) {
    try { this.#validateAction(action, input, signal); }
    catch (error) { return Promise.reject(error); }
    return this.#request({ type: "action", action, input }, signal, 35000);
  }
  #request(message, signal, timeout) {
    return new Promise((resolve, reject) => {
      const id = String(++this.#next);
      const cancel = () => this.#cancel(id, signal?.reason ?? new DOMException("Action cancelled.", "AbortError"));
      const timer = setTimeout(() => this.#cancel(id, new Error("Plugin request timed out.")), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
      this.#pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", cancel, { once: true });
      try { this.#port.postMessage({ id, ...message }); }
      catch (error) { this.#cancel(id, error); }
    });
  }
  #validateAction(action, input, signal) {
    if (this.#closed) throw new Error("This block is closed.");
    if (this.context.mode === "read") throw new Error("Reader blocks cannot execute actions.");
    signal?.throwIfAborted();
    if (this.#pending.size >= 4) throw new Error("Wait for an action to finish before starting another.");
    if (typeof action !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(action)) throw new Error("Invalid action name.");
    if (!input || typeof input !== "object" || Array.isArray(input) || bytes(JSON.stringify({ input })) > 65536) throw new Error("Action input must be an object within 64 KiB.");
  }
  #cancel(id, error) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.cleanup();
    this.#port.postMessage({ id, type: "cancel" });
    pending.reject(error);
  }
  change(source) {
    if (this.#closed || this.context.mode !== "edit") throw new Error("Block changes are only available in the editor.");
    if (typeof source !== "string" || bytes(source) > SOURCE_LIMIT) throw new Error("Block source exceeds 1.5 MiB.");
    this.#port.postMessage({ type: "change", source });
  }
  resize(height) {
    if (!this.#closed && Number.isFinite(height)) this.#port.postMessage({ type: "resize", height: Math.min(1000, Math.max(180, Math.ceil(height))) });
  }
  setCleanup(action, input = {}) {
    if (action === null) {
      if (!this.#closed) this.#port.postMessage({ type: "cleanup", action: null });
      return;
    }
    this.#validateAction(action, input);
    if (bytes(JSON.stringify({ input })) > 4096) throw new Error("Cleanup input exceeds 4 KiB.");
    this.#port.postMessage({ type: "cleanup", action, input });
  }
  async importTextFile({ accept = "", maxBytes = SOURCE_LIMIT, signal } = {}) {
    if (this.#closed) throw new Error("This block is closed.");
    if (this.context.mode !== "edit") throw new Error("File import is only available in the editor.");
    signal?.throwIfAborted();
    if (this.#importing) throw new Error("Finish the current file import first.");
    if (typeof accept !== "string" || accept.length > 200 || (accept && !accept.split(",").every(part => /^(?:\.[a-zA-Z0-9][a-zA-Z0-9._-]*|[a-zA-Z0-9][a-zA-Z0-9.+-]*\/(?:[a-zA-Z0-9][a-zA-Z0-9.+-]*|\*))$/.test(part.trim())))) throw new Error("Invalid file types for import.");
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > SOURCE_LIMIT) throw new Error("Import size must be between 1 byte and 1.5 MiB.");
    this.#importing = true;
    try {
      const file = await this.#request({ type: "import", accept, maxBytes }, signal, 300000);
      if (file === null) return null;
      if (!file || typeof file.name !== "string" || !file.name || file.name.length > 255 || typeof file.text !== "string" || bytes(file.text) > maxBytes) throw new Error("Margin returned an invalid or oversized file.");
      return { name: file.name, text: file.text };
    } finally { this.#importing = false; }
  }
  download(name, mime, text) {
    if (this.#closed) throw new Error("This block is closed.");
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(name)) throw new Error("Choose a plain download filename.");
    if (typeof mime !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) || mime.length > 100) throw new Error("Invalid download content type.");
    if (typeof text !== "string" || bytes(text) > SOURCE_LIMIT) throw new Error("Download exceeds 1.5 MiB.");
    this.#port.postMessage({ type: "download", name, mime, text });
  }
  close() {
    if (this.#closed) return;
    for (const id of this.#pending.keys()) this.#cancel(id, new Error("This block was closed."));
    this.#port.postMessage({ type: "close" });
    this.#closed = true;
    this.#port.onmessage = null;
    this.#port.onmessageerror = null;
    this.#port.close();
  }
}
