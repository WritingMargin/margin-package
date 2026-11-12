import type { NotebookOutput } from "./notebook.ts";
export type InvokeNotebookAction = (
  action: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
export interface CellExecution {
  outputs: NotebookOutput[];
  executionCount: number;
}
export function readCellExecution(
  value: Record<string, unknown>,
): CellExecution {
  if (
    !Array.isArray(value.outputs) ||
    !value.outputs.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    ) ||
    !Number.isInteger(value.executionCount)
  ) {
    throw new Error("The plugin returned an invalid cell result.");
  }
  return {
    outputs: value.outputs as NotebookOutput[],
    executionCount: value.executionCount as number,
  };
}
/** Each owner preview owns one session; results never modify the article source. */
export class NotebookRunner {
  private sessionId = "";
  private disposed = false;
  private cancelled = false;
  private busy = false;
  private leaseActive = false;
  private heartbeatGeneration: number | null = null;
  private leaseGeneration = 0;
  private recoveryNeeded = false;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private heartbeatMs: number;
  private onLeaseError: (error: unknown) => void;
  private abandoned = false;
  private notebookId: string;
  private invoke: InvokeNotebookAction;
  private cleanup: (
    action: string | null,
    input?: Record<string, unknown>,
  ) => void;
  constructor(
    notebookId: string,
    invoke: InvokeNotebookAction,
    cleanup: (
      action: string | null,
      input?: Record<string, unknown>,
    ) => void = () => {},
    options: {
      heartbeatMs?: number;
      onLeaseError?: (error: unknown) => void;
    } = {},
  ) {
    this.notebookId = notebookId;
    this.invoke = invoke;
    this.cleanup = cleanup;
    this.heartbeatMs = options.heartbeatMs ?? 5000;
    this.onLeaseError = options.onLeaseError ?? (() => {});
  }
  private async session() {
    if (this.recoveryNeeded) await this.recoverSession();
    if (this.disposed) throw new Error("Notebook preview closed.");
    if (this.sessionId) {
      this.startLease();
      return this.sessionId;
    }
    const result = await this.invoke("session.create", {
      notebookId: this.notebookId,
      managed: true,
    });
    if (typeof result.sessionId !== "string" || !result.sessionId)
      throw new Error("The plugin did not create a notebook session.");
    this.sessionId = result.sessionId;
    this.cleanup("session.close", { sessionId: this.sessionId });
    if (this.disposed) {
      await this.close();
      throw new Error("Notebook preview closed.");
    }
    this.startLease();
    return this.sessionId;
  }
  private async recoverSession() {
    const oldSession = this.sessionId;
    this.stopLease();
    if (oldSession) await this.closeStaleSession(oldSession);
    if (this.disposed) throw new Error("Notebook preview closed.");
    this.sessionId = "";
    this.recoveryNeeded = false;
  }
  private async closeStaleSession(sessionId: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 2000);
    });
    try {
      await Promise.race([
        this.invoke("session.close", { sessionId }).catch(() => {}),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
    // A lost close response is safe to abandon: this managed session no longer
    // renews and expires independently. A new session replaces the cleanup slot.
  }
  private startLease() {
    if (this.disposed || !this.sessionId) return;
    this.leaseActive = true;
    this.scheduleHeartbeat();
  }
  private scheduleHeartbeat() {
    if (
      !this.leaseActive ||
      this.heartbeatGeneration === this.leaseGeneration ||
      this.heartbeatTimer
    )
      return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      void this.heartbeat();
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }
  private async heartbeat() {
    if (!this.leaseActive || this.disposed || !this.sessionId) return;
    const generation = this.leaseGeneration;
    const sessionId = this.sessionId;
    this.heartbeatGeneration = generation;
    try {
      await this.invoke("session.heartbeat", { sessionId });
    } catch (error) {
      if (generation === this.leaseGeneration && sessionId === this.sessionId) {
        this.stopLease();
        this.recoveryNeeded = true;
        this.cancelled = true;
        if (!this.disposed) this.onLeaseError(error);
      }
    } finally {
      if (this.heartbeatGeneration === generation)
        this.heartbeatGeneration = null;
      if (generation === this.leaseGeneration) this.scheduleHeartbeat();
    }
  }
  private stopLease() {
    this.leaseGeneration++;
    this.leaseActive = false;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
  /** Stop renewal synchronously before the frame port is closed. Host cleanup closes the kernel. */
  dispose() {
    this.abandoned = true;
    this.disposed = true;
    this.cancelled = true;
    this.stopLease();
  }
  async run(
    cells: { index: number; code: string }[],
    onResult: (index: number, result: CellExecution) => void,
  ) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.cancelled = false;
    try {
      const sessionId = await this.session();
      for (const cell of cells) {
        if (this.cancelled || this.disposed) break;
        const result = readCellExecution(
          await this.invoke("cell.execute", { sessionId, code: cell.code }),
        );
        if (this.cancelled || this.disposed) break;
        onResult(cell.index, result);
        if (result.outputs.some((output) => "traceback" in output)) break;
      }
    } catch (error) {
      this.stopLease();
      this.recoveryNeeded = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async interrupt() {
    this.cancelled = true;
    try {
      if (this.sessionId)
        await this.invoke("session.interrupt", { sessionId: this.sessionId });
    } catch (error) {
      this.stopLease();
      throw error;
    }
  }
  async restart() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      if (this.sessionId) {
        const sessionId = await this.session();
        await this.invoke("session.restart", { sessionId });
      }
      this.startLease();
    } catch (error) {
      this.stopLease();
      this.recoveryNeeded = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async close() {
    this.disposed = true;
    this.cancelled = true;
    this.stopLease();
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      await this.invoke("session.close", { sessionId });
    } catch (error) {
      this.disposed = this.abandoned;
      throw error;
    }
    this.sessionId = "";
    this.cleanup(null);
  }
}
