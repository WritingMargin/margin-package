"""Bounded Jupyter sessions for trusted authors, not an untrusted-code sandbox."""
import concurrent.futures
import json
import os
import queue
import secrets
import tempfile
import threading
import time
from pathlib import Path

MAX_OUTPUT_BYTES = 192 * 1024
MAX_OUTPUT_ITEMS = 200


class PluginError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def kernel_environment(directory):
    # Do not inherit the service bearer token, engine secrets, or the host environment.
    path = str(Path(os.sys.executable).parent)
    return {"PATH": path, "HOME": directory, "TMPDIR": directory,
            "LANG": "C.UTF-8", "PYTHONNOUSERSITE": "1", "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1",
            "IPYTHONDIR": str(Path(directory) / "ipython"),
            "JUPYTER_RUNTIME_DIR": directory, "MPLCONFIGDIR": str(Path(directory) / "matplotlib")}


class OutputCollector:
    def __init__(self):
        self.outputs = []
        self.count = 0
        self.clear_next = False
        self.display_ids = {}

    def add(self, kind, content):
        if kind == "execute_input":
            self.count = int(content.get("execution_count", 0))
            return
        if kind == "clear_output":
            if content.get("wait"):
                self.clear_next = True
            else:
                self.clear()
            return
        output = self.output(kind, content)
        if output is None:
            return
        if self.clear_next:
            self.clear()
        display_id = content.get("transient", {}).get("display_id")
        if kind == "update_display_data" and display_id in self.display_ids:
            self.outputs[self.display_ids[display_id]] = output
        else:
            if display_id:
                self.display_ids[display_id] = len(self.outputs)
            self.outputs.append(output)
        if len(self.outputs) > MAX_OUTPUT_ITEMS or len(json.dumps(self.outputs).encode()) > MAX_OUTPUT_BYTES:
            raise PluginError(413, "OUTPUT_LIMIT", "Cell output exceeded the limit. Kernel restarted; variables were cleared.")

    def clear(self):
        self.outputs = []
        self.display_ids = {}
        self.clear_next = False

    @staticmethod
    def output(kind, content):
        if kind == "stream":
            return {"output_type": "stream", "name": content.get("name", "stdout"),
                    "text": content.get("text", "")}
        if kind == "error":
            return {"output_type": "error", "ename": content.get("ename", "Error"),
                    "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])}
        if kind not in ("display_data", "execute_result", "update_display_data"):
            return None
        data = {key: value for key, value in content.get("data", {}).items()
                if key in ("text/plain", "image/png")}
        result = {"output_type": "execute_result" if kind == "execute_result" else "display_data",
                  "data": data, "metadata": {}}
        if kind == "execute_result":
            result["execution_count"] = int(content.get("execution_count", 0))
        return result


class JupyterDriver:
    def __init__(self, directory, timeout):
        from jupyter_client import KernelManager
        from jupyter_client.kernelspec import KernelSpecManager
        self.timeout = timeout
        self.stopping = threading.Event()
        # Never resolve an installed host kernelspec. The service's own interpreter
        # also runs each kernel, including when relocated inside a plugin package.
        kernels = Path(directory) / "kernels"
        spec = kernels / "margin-python"
        spec.mkdir(parents=True)
        (spec / "kernel.json").write_text(json.dumps({
            "argv": [os.sys.executable, "-B", "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "Margin Python", "language": "python",
        }))
        self.manager = KernelManager(kernel_name="margin-python", kernel_spec_manager=KernelSpecManager(
            kernel_dirs=[str(kernels)], ensure_native_kernel=False))
        self.client = None
        try:
            self.manager.start_kernel(cwd=directory, env=kernel_environment(directory))
            self.client = self.manager.blocking_client()
            self.client.start_channels()
            self.client.wait_for_ready(timeout=8)
        except Exception:
            self.close()
            raise

    def execute(self, code):
        message_id = self.client.execute(code, store_history=True, allow_stdin=False, stop_on_error=True)
        collector = OutputCollector()
        deadline = time.monotonic() + self.timeout
        try:
            self.collect(message_id, collector, deadline)
        except PluginError:
            if self.stopping.is_set():
                raise
            self.interrupt()
            # Hard reset after output/time limits prevents abandoned output or
            # background work from leaking into the next execution.
            self.manager.restart_kernel(now=True)
            self.client.wait_for_ready(timeout=5)
            raise
        return {"outputs": collector.outputs, "executionCount": collector.count}

    def collect(self, message_id, collector, deadline):
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise PluginError(408, "EXECUTION_TIMEOUT", "Cell exceeded its time limit. Kernel restarted; variables were cleared.")
            try:
                message = self.client.get_iopub_msg(timeout=min(remaining, 0.25))
            except queue.Empty:
                if not self.manager.is_alive():
                    raise PluginError(502, "KERNEL_STOPPED", "The Python kernel stopped. Restart the notebook.")
                continue
            if message.get("parent_header", {}).get("msg_id") != message_id:
                continue
            kind = message.get("msg_type", message.get("header", {}).get("msg_type"))
            content = message.get("content", {})
            if kind == "status" and content.get("execution_state") == "idle":
                self.drain_reply(message_id, deadline)
                return
            collector.add(kind, content)

    def drain_reply(self, message_id, deadline):
        while time.monotonic() < deadline:
            try:
                reply = self.client.get_shell_msg(timeout=0.25)
            except queue.Empty:
                continue
            if reply.get("parent_header", {}).get("msg_id") == message_id:
                return
        raise PluginError(408, "EXECUTION_TIMEOUT", "Kernel did not finish its reply. Kernel restarted; variables were cleared.")

    def interrupt(self):
        if self.manager.has_kernel:
            self.manager.interrupt_kernel()

    def stop(self):
        self.stopping.set()
        self.interrupt()

    def restart(self):
        if self.stopping.is_set():
            raise PluginError(404, "SESSION_NOT_FOUND", "Notebook session has closed.")
        self.manager.restart_kernel(now=True)
        self.client.wait_for_ready(timeout=8)
        return {"ok": True}

    def close(self):
        self.stopping.set()
        if self.client:
            self.client.stop_channels()
        self.kill()

    def kill(self):
        self.stopping.set()
        if self.manager.has_kernel:
            self.manager.shutdown_kernel(now=True)


class KernelSession:
    """All ZeroMQ client operations stay on a dedicated worker thread."""
    def __init__(self, identity, notebook_id, timeout, driver_factory=JupyterDriver):
        self.identity = identity
        self.notebook_id = notebook_id
        self.last_used = time.monotonic()
        self.busy = threading.Lock()
        self.closed = threading.Event()
        self.tasks = queue.Queue(maxsize=1)
        self.driver = None
        self.ready = concurrent.futures.Future()
        self.thread = threading.Thread(target=self.work, args=(timeout, driver_factory), daemon=True)
        self.thread.start()
        try:
            self.ready.result(timeout=10)
        except Exception:
            self.closed.set()
            raise PluginError(502, "KERNEL_START_FAILED", "Could not start the Python kernel.") from None

    def work(self, timeout, driver_factory):
        with tempfile.TemporaryDirectory(prefix="margin-kernel-") as directory:
            try:
                self.driver = driver_factory(directory, timeout)
                self.ready.set_result(True)
                while not self.closed.is_set():
                    try:
                        command, value, future = self.tasks.get(timeout=0.25)
                    except queue.Empty:
                        continue
                    self.run_task(command, value, future)
            except Exception as error:
                if not self.ready.done():
                    self.ready.set_exception(error)
            finally:
                if self.driver:
                    self.driver.close()

    def run_task(self, command, value, future):
        try:
            result = self.driver.execute(value) if command == "execute" else self.driver.restart()
            future.set_result(result)
        except PluginError as error:
            future.set_exception(error)
        except Exception:
            future.set_exception(PluginError(502, "KERNEL_ERROR", "The kernel failed. Restart the notebook."))

    def call(self, command, value=None):
        if self.closed.is_set():
            raise PluginError(404, "SESSION_NOT_FOUND", "Notebook session expired. Start a new session.")
        if not self.busy.acquire(blocking=False):
            raise PluginError(409, "SESSION_BUSY", "This notebook is already running a cell.")
        try:
            self.last_used = time.monotonic()
            future = concurrent.futures.Future()
            self.tasks.put_nowait((command, value, future))
            return future.result(timeout=28)
        except concurrent.futures.TimeoutError:
            self.close()
            raise PluginError(408, "EXECUTION_TIMEOUT", "The notebook stopped responding. Start a new session.") from None
        finally:
            self.last_used = time.monotonic()
            self.busy.release()

    def interrupt(self):
        self.last_used = time.monotonic()
        self.driver.interrupt()
        return {"ok": True}

    def close(self):
        self.closed.set()
        if self.driver:
            getattr(self.driver, "stop", self.driver.interrupt)()
        self.thread.join(timeout=0.5)
        # The daemon worker normally finishes on interruption. A kernel that
        # ignores it is killed so it cannot outlive its closed session.
        if self.thread.is_alive() and self.driver:
            self.driver.kill()
            self.thread.join(timeout=0.5)
        return {"ok": True}


class Sessions:
    def __init__(self, maximum=4, ttl=600, timeout=20, factory=KernelSession,
                 lease_seconds=30, reap_interval=1, clock=time.monotonic):
        self.maximum = maximum
        self.ttl = ttl
        self.timeout = timeout
        self.factory = factory
        self.lease_seconds = lease_seconds
        self.reap_interval = reap_interval
        self.clock = clock
        self.leases = {}
        self.lock = threading.Lock()
        self.items = {}
        self.creating = 0
        self.stopping = threading.Event()
        self.reaper = threading.Thread(target=self.reap_loop, daemon=True)
        self.reaper.start()

    def create(self, identity, notebook_id, managed=False):
        # Reserve capacity without blocking interrupt/close while a kernel starts.
        with self.lock:
            if len(self.items) + self.creating >= self.maximum or self.stopping.is_set():
                raise PluginError(429, "SESSION_LIMIT", "All notebook sessions are in use. Close one or try later.")
            self.creating += 1
        try:
            session = self.factory(identity, notebook_id, self.timeout)
            session_id = secrets.token_urlsafe(24)
            with self.lock:
                if self.stopping.is_set():
                    session.close()
                    raise PluginError(503, "SHUTTING_DOWN", "The notebook service is shutting down.")
                self.items[session_id] = session
                if managed:
                    self.leases[session_id] = self.clock() + self.lease_seconds
        finally:
            with self.lock:
                self.creating -= 1
        return {"sessionId": session_id}

    def lookup_locked(self, identity, session_id):
        session = self.items.get(session_id)
        expired = session_id in self.leases and self.clock() >= self.leases[session_id]
        if not session or session.identity != identity or session.closed.is_set() or expired:
            raise PluginError(404, "SESSION_NOT_FOUND", "Notebook session was not found for this author.")
        return session

    def get(self, identity, session_id):
        with self.lock:
            return self.lookup_locked(identity, session_id)

    def heartbeat(self, identity, session_id):
        with self.lock:
            self.lookup_locked(identity, session_id)
            if session_id not in self.leases:
                raise PluginError(409, "SESSION_NOT_MANAGED", "This session does not use an editor lease.")
            self.leases[session_id] = self.clock() + self.lease_seconds
        return {"ok": True}

    def close(self, identity, session_id):
        with self.lock:
            session = self.items.get(session_id)
            if session and session.identity != identity:
                raise PluginError(404, "SESSION_NOT_FOUND", "Notebook session was not found for this author.")
            self.items.pop(session_id, None)
            self.leases.pop(session_id, None)
        return session.close() if session else {"ok": True}

    def expired(self, key, session, now):
        if key in self.leases:
            # Only owner heartbeats renew managed sessions, never cell activity.
            # Busy kernels must stop too when their editor disappears.
            return now >= self.leases[key] or session.closed.is_set()
        return session.closed.is_set() or (not session.busy.locked() and time.monotonic() - session.last_used > self.ttl)

    def reap(self):
        with self.lock:
            now = self.clock()
            expired = [key for key, session in self.items.items() if self.expired(key, session, now)]
            sessions = [self.items.pop(key) for key in expired]
            for key in expired:
                self.leases.pop(key, None)
        for session in sessions:
            session.close()

    def reap_loop(self):
        while not self.stopping.wait(self.reap_interval):
            self.reap()

    def shutdown(self):
        self.stopping.set()
        with self.lock:
            sessions = list(self.items.values())
            self.items.clear()
            self.leases.clear()
        # Margin allows a short graceful-stop window. Close kernels concurrently
        # so four sessions do not multiply each other's shutdown delay.
        workers = [threading.Thread(target=session.close, daemon=True) for session in sessions]
        for worker in workers:
            worker.start()
        deadline = time.monotonic() + 1.5
        for worker in workers:
            worker.join(timeout=max(0, deadline - time.monotonic()))
