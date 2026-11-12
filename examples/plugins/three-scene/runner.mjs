import { Worker } from "node:worker_threads";
const activeWorkers = new Set();
export function activeWorkerCount() { return activeWorkers.size; }
function failure(message) { return { ok: false, logs: [], error: message.slice(0, 2000) }; }
export async function stopWorkers() {
  await Promise.all([...activeWorkers].map((worker) => worker.terminate()));
}
/** Workers isolate job lifetime; neither worker_threads nor node:vm sandbox hostile code. */
export function executeScene(code, signal, { timeoutMs = 5000 } = {}) {
  if (signal.aborted) return Promise.resolve(failure("Execution cancelled."));
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { code }, env: {},
      resourceLimits: { maxOldGenerationSizeMb: 112, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    activeWorkers.add(worker);
    let settled = false;
    let timer;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      await worker.terminate();
      activeWorkers.delete(worker);
      resolve(result);
    };
    const cancel = () => { void finish(failure("Execution cancelled.")); };
    timer = setTimeout(() => { void finish(failure("Scene execution exceeded its five-second limit.")); }, timeoutMs);
    signal.addEventListener("abort", cancel, { once: true });
    worker.once("message", (result) => { void finish(result); });
    worker.once("error", (error) => { void finish(failure(`Scene worker failed: ${error.message}`)); });
    worker.once("exit", (code) => { void finish(failure(`Scene worker stopped before returning a scene (exit ${code}).`)); });
    if (signal.aborted) cancel();
  });
}
