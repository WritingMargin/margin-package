import { startPlugin } from "@margin/plugin-sdk";
import plugin from "./plugin.mjs";
import { stopWorkers } from "./runner.mjs";
const server = await startPlugin(plugin, { concurrency: 2, timeoutMs: 7000 });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  server.close(); server.closeIdleConnections();
  void stopWorkers();
});
