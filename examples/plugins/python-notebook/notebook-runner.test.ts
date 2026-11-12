import test from "node:test";
import assert from "node:assert/strict";
import {
  NotebookRunner,
  readCellExecution,
  type InvokeNotebookAction,
} from "./lib/notebook-runner.ts";
function fixture() {
  const calls: { action: string; input: Record<string, unknown> }[] = [];
  let count = 0;
  const invoke: InvokeNotebookAction = async (action, input) => {
    calls.push({ action, input });
    if (action === "session.create") return { sessionId: "session-1" };
    if (action === "cell.execute")
      return {
        outputs: [{ text: String(input.code) }],
        executionCount: ++count,
      };
    return { ok: true };
  };
  return { calls, invoke };
}
test("notebook session executes sequentially, reuses state, and closes", async () => {
  const { calls, invoke } = fixture();
  const runner = new NotebookRunner("book", invoke);
  const results: number[] = [];
  await runner.run(
    [
      { index: 2, code: "a=1" },
      { index: 4, code: "print(a)" },
    ],
    (index) => results.push(index),
  );
  await runner.run([{ index: 4, code: "print(a)" }], (index) =>
    results.push(index),
  );
  await runner.restart();
  await runner.close();
  assert.deepEqual(results, [2, 4, 4]);
  assert.deepEqual(
    calls.map((call) => call.action),
    [
      "session.create",
      "cell.execute",
      "cell.execute",
      "cell.execute",
      "session.restart",
      "session.close",
    ],
  );
  assert.deepEqual(calls[0].input, { notebookId: "book", managed: true });
  assert.equal(calls[1].input.sessionId, "session-1");
});
test("stopping a run discards late results and skips remaining cells", async () => {
  const { invoke, calls } = fixture();
  let finish!: (result: Record<string, unknown>) => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const runner = new NotebookRunner("book", async (action, input) => {
    if (action !== "cell.execute") return invoke(action, input);
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  let outputs = 0;
  const run = runner.run(
    [
      { index: 0, code: "slow()" },
      { index: 1, code: "later()" },
    ],
    () => outputs++,
  );
  await pending;
  await runner.interrupt();
  finish({ outputs: [], executionCount: 1 });
  await run;
  assert.equal(outputs, 0);
  assert.equal(calls.at(-1)?.action, "session.interrupt");
});
test("closing while session creation is pending closes the late session", async () => {
  let finish!: (result: Record<string, unknown>) => void;
  const calls: string[] = [];
  const runner = new NotebookRunner("book", async (action) => {
    calls.push(action);
    if (action === "session.create")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { ok: true };
  });
  const run = runner.run([{ index: 0, code: "print(1)" }], () =>
    assert.fail("closed preview received a result"),
  );
  await runner.close();
  finish({ sessionId: "late" });
  await assert.rejects(run, /preview closed/);
  assert.deepEqual(calls, ["session.create", "session.close"]);
});
test("run all stops at a code error and rejects malformed plugin output", async () => {
  let executed = 0;
  const runner = new NotebookRunner("book", async (action) => {
    if (action === "session.create") return { sessionId: "one" };
    executed++;
    return {
      outputs: [{ traceback: ["NameError"] }],
      executionCount: executed,
    };
  });
  await runner.run(
    [
      { index: 0, code: "missing" },
      { index: 1, code: "later" },
    ],
    () => {},
  );
  assert.equal(executed, 1);
  assert.throws(
    () => readCellExecution({ outputs: [null], executionCount: 1 }),
    /invalid/,
  );
  assert.throws(
    () => readCellExecution({ outputs: [], executionCount: "1" }),
    /invalid/,
  );
});
test("parallel run attempts do not interleave a notebook session", async () => {
  let finish!: (result: Record<string, unknown>) => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const calls: string[] = [];
  const runner = new NotebookRunner("book", async (action) => {
    calls.push(action);
    if (action === "session.create") return { sessionId: "one" };
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const run = runner.run([{ index: 0, code: "first" }], () => {});
  await pending;
  await runner.run([{ index: 1, code: "second" }], () =>
    assert.fail("overlapping run"),
  );
  await runner.restart();
  finish({ outputs: [], executionCount: 1 });
  await run;
  assert.deepEqual(calls, ["session.create", "cell.execute"]);
});
test("session cleanup registers on creation and clears only after successful close", async () => {
  const { invoke } = fixture();
  const cleanup: unknown[] = [];
  const runner = new NotebookRunner("book", invoke, (action, input) =>
    cleanup.push({ action, input }),
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  assert.deepEqual(cleanup, [
    { action: "session.close", input: { sessionId: "session-1" } },
  ]);
  await runner.close();
  assert.deepEqual(cleanup.at(-1), { action: null, input: undefined });
});
test("failed explicit close preserves the host cleanup registration", async () => {
  const cleanup: unknown[] = [];
  const runner = new NotebookRunner(
    "book",
    async (action) => {
      if (action === "session.create") return { sessionId: "one" };
      if (action === "cell.execute") return { outputs: [], executionCount: 1 };
      throw new Error("offline");
    },
    (action) => cleanup.push(action),
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await assert.rejects(runner.close(), /offline/);
  assert.deepEqual(cleanup, ["session.close"]);
});
test("a failed explicit close can still run and retry cleanup", async () => {
  let closes = 0,
    executions = 0;
  const cleanup: unknown[] = [];
  const runner = new NotebookRunner(
    "book",
    async (action) => {
      if (action === "session.create") return { sessionId: "one" };
      if (action === "cell.execute")
        return { outputs: [], executionCount: ++executions };
      if (++closes === 1) throw new Error("temporary network failure");
      return { ok: true };
    },
    (action) => cleanup.push(action),
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await assert.rejects(runner.close(), /temporary/);
  await runner.run([{ index: 0, code: "2" }], () => {});
  assert.equal(executions, 2);
  await runner.close();
  assert.deepEqual(cleanup, ["session.close", null]);
});
const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for runner state.");
    await delay(2);
  }
}
test("managed session heartbeats never overlap and page leave stops renewal even with a pending reply", async () => {
  let beats = 0;
  let complete!: (value: Record<string, unknown>) => void;
  const cleanup: unknown[] = [];
  const runner = new NotebookRunner(
    "lease",
    async (action, input) => {
      if (action === "session.create") {
        assert.equal(input.managed, true);
        return { sessionId: "lease-session" };
      }
      if (action === "session.heartbeat") {
        beats++;
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
      return { outputs: [], executionCount: 1 };
    },
    (action) => cleanup.push(action),
    { heartbeatMs: 5 },
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await until(() => beats === 1);
  await delay(20);
  assert.equal(beats, 1, "pending heartbeats must not overlap");
  runner.dispose();
  complete({ ok: true });
  await delay(20);
  assert.equal(beats, 1, "disposed frame must not renew its lease");
  assert.deepEqual(
    cleanup,
    ["session.close"],
    "host cleanup remains registered on page leave",
  );
});
test("heartbeat failure stops renewal and reports the lost connection once", async () => {
  let beats = 0,
    errors = 0;
  const runner = new NotebookRunner(
    "lease",
    async (action) => {
      if (action === "session.create") return { sessionId: "one" };
      if (action === "session.heartbeat") {
        beats++;
        throw new Error("port closed");
      }
      return { outputs: [], executionCount: 1 };
    },
    () => {},
    { heartbeatMs: 5, onLeaseError: () => errors++ },
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await until(() => errors === 1);
  await delay(20);
  assert.equal(beats, 1);
  assert.equal(errors, 1);
  runner.dispose();
});
test("failed explicit close stops renewal but keeps cleanup and supports close retry", async () => {
  let beats = 0,
    closes = 0;
  const cleanup: unknown[] = [];
  const runner = new NotebookRunner(
    "lease",
    async (action) => {
      if (action === "session.create") return { sessionId: "one" };
      if (action === "session.heartbeat") {
        beats++;
        return { ok: true };
      }
      if (action === "session.close" && ++closes === 1)
        throw new Error("offline");
      return { outputs: [], executionCount: 1 };
    },
    (action) => cleanup.push(action),
    { heartbeatMs: 5 },
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await until(() => beats > 0);
  await assert.rejects(runner.close(), /offline/);
  const stopped = beats;
  await delay(20);
  assert.equal(beats, stopped);
  assert.deepEqual(cleanup, ["session.close"]);
  await runner.close();
  assert.deepEqual(cleanup, ["session.close", null]);
});
test("a session arriving after disposal is immediately closed without starting a heartbeat", async () => {
  let resolveCreate!: (value: Record<string, unknown>) => void;
  const calls: string[] = [];
  const runner = new NotebookRunner(
    "late",
    async (action) => {
      calls.push(action);
      if (action === "session.create")
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      return { ok: true };
    },
    () => {},
    { heartbeatMs: 5 },
  );
  const run = runner.run([{ index: 0, code: "1" }], () =>
    assert.fail("disposed run returned output"),
  );
  runner.dispose();
  resolveCreate({ sessionId: "late-one" });
  await assert.rejects(run, /preview closed/);
  await delay(15);
  assert.deepEqual(calls, ["session.create", "session.close"]);
});
test("after a lost lease the next run closes the old kernel and creates a fresh managed session", async () => {
  let created = 0,
    reported = 0;
  const executed: string[] = [];
  const closed: string[] = [];
  const runner = new NotebookRunner(
    "recovery",
    async (action, input) => {
      if (action === "session.create")
        return { sessionId: `kernel-${++created}` };
      if (action === "session.heartbeat" && input.sessionId === "kernel-1")
        throw new Error("expired");
      if (action === "session.close") {
        closed.push(String(input.sessionId));
        throw new Error("old session already gone");
      }
      if (action === "cell.execute") {
        executed.push(String(input.sessionId));
        return { outputs: [], executionCount: 1 };
      }
      return { ok: true };
    },
    () => {},
    { heartbeatMs: 5, onLeaseError: () => reported++ },
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await until(() => reported === 1);
  await runner.run([{ index: 0, code: "2" }], () => {});
  assert.deepEqual(executed, ["kernel-1", "kernel-2"]);
  assert.deepEqual(closed, ["kernel-1"]);
  runner.dispose();
});
test("late heartbeat failure from a retired generation cannot cancel a replacement kernel", async () => {
  let created = 0,
    reported = 0;
  let rejectOld!: (error: Error) => void;
  let oldBeat = false;
  let failExecution = false;
  const beats: string[] = [];
  const runner = new NotebookRunner(
    "race",
    async (action, input) => {
      if (action === "session.create")
        return { sessionId: `kernel-${++created}` };
      if (action === "session.heartbeat") {
        beats.push(String(input.sessionId));
        if (input.sessionId === "kernel-1") {
          oldBeat = true;
          return new Promise((_resolve, reject) => {
            rejectOld = reject;
          });
        }
        return { ok: true };
      }
      if (action === "cell.execute") {
        if (failExecution) {
          failExecution = false;
          throw new Error("transport lost");
        }
        return { outputs: [], executionCount: 1 };
      }
      return { ok: true };
    },
    () => {},
    { heartbeatMs: 5, onLeaseError: () => reported++ },
  );
  await runner.run([{ index: 0, code: "1" }], () => {});
  await until(() => oldBeat);
  failExecution = true;
  await assert.rejects(
    runner.run([{ index: 0, code: "2" }], () => {}),
    /transport/,
  );
  await runner.run([{ index: 0, code: "3" }], () => {});
  rejectOld(new Error("late old failure"));
  await until(() => beats.includes("kernel-2"));
  assert.equal(reported, 0);
  assert.equal(created, 2);
  runner.dispose();
});
