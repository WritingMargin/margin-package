# Optional Python notebook plugin

This optional package owns the notebook editor, saved-output reader, cell controls,
`.ipynb` import/export, and Python execution in a private Jupyter kernel.
Margin supplies only the generic plugin frame and action bridge; installing the
package adds the notebook experience.
The installable package includes its own Python interpreter and dependencies;
Margin's host needs no Python installation. Nothing is bundled with core Margin
by default. Execution is for **trusted publication-owner code only**.

## Build an installable notebook package

The package build and real engine execution are verified on **macOS arm64** with
standalone CPython **3.12.14**, ipykernel **6.29.5** and jupyter_client **8.6.3**.
Build on the target platform; Linux and amd64 builds need their own verification.
You need Node.js 24+ for the interface bundler and archive writer and a relocatable standalone Python
on the development machine, not on the Margin host.

One way to obtain the interpreter is [uv's managed Python distribution](https://docs.astral.sh/uv/concepts/python-versions/).
From the Margin repository root:

```sh
npm ci --prefix examples/plugins/python-notebook
uv python install 3.12.14
PLUGIN_PYTHON="$(uv python find --managed-python 3.12.14)"
PLUGIN_PYTHON_ROOT="$("$PLUGIN_PYTHON" -c 'import sys; print(sys.prefix)')"
"$PLUGIN_PYTHON" -B examples/plugins/python-notebook/build-package.py \
  --python-root "$PLUGIN_PYTHON_ROOT" \
  --output /tmp/python-notebook.margin-plugin
```

The builder compiles `ui/notebook.html` as one offline browser document and hashes
it into the archive alongside the runtime. Node and UI build dependencies are not
needed on the Margin host or included as execution dependencies.
The builder works on a temporary copy. It never installs packages into the
selected source interpreter. It includes the interpreter, standard library,
dependency resources and licenses; pins the two direct Jupyter dependencies;
resolves their transitive dependencies at build time; and excludes pip,
upstream test certificates, bytecode caches and temporary-path console scripts.
Use your dependency constraints/index controls if you need an identical dependency
resolution across future rebuilds. The verified archive is about 106 MiB.

Install the resulting file in **Settings → Integrations → Plugins**, review it,
and enable it. Margin starts the service and creates its connection credential.
Choose **Jupyter notebook** from the editor’s plugin blocks. Run the starter cells
in order; the second uses state from the first. You can also import
[`example.ipynb`](example.ipynb) inside the package interface. New blocks use
`plugin:python-notebook:notebook`; existing `ipynb` fences resolve through the
package’s declared language alias. Readers see saved outputs and cannot run code.
When the package is unavailable, Margin shows its generic unavailable-block
message and preserves the article source.

Each kernel launches the same bundled interpreter through an explicitly written
private kernelspec. It inherits neither service credentials nor engine secrets.
Both service and kernel disable bytecode writes, keeping package hashes stable.
Disabling stops all active kernels concurrently during Margin's graceful-stop
window. Kernels remain trusted code sharing the plugin service's OS privileges;
this is not a public execution sandbox.

To test the archive through a running engine, from the repository root:

```sh
# Place a plugin-capable Margin server at artifacts/margin-server.
node tests/python-package-smoke.mjs /tmp/python-notebook.margin-plugin
```

The smoke test starts an isolated engine with an empty PATH, installs/enables the
archive, executes cells using the bundled interpreter, tests interruption,
restart, outputs and errors, verifies multiple kernel processes are cleaned up,
and exercises disable/re-enable, engine restart and uninstall.

The standalone service and Docker options below are useful for developing the
execution protocol. This version’s interface requires package installation;
Margin rejects external manifests containing UI blocks because it cannot load
their verified package files. To write other plugins, see the
[plugin quickstart](../../../docs/plugins-quickstart.md) and
[package contract](../../../docs/plugin-packages.md).

## Develop the execution service with Docker

The optional container uses Python 3.12 and pins the direct Jupyter dependencies.
From this directory:

```sh
export MARGIN_PLUGIN_TOKEN="$(openssl rand -hex 32)"
docker compose up --build -d
```

Keep the generated token in your secret manager so the service can be restarted
with the same credential. Do not commit it. The provided compose file binds only
`127.0.0.1:8101`, runs as a non-root user, and sets memory (512 MiB), CPU (1 core),
process (128 PID), and temporary-storage limits. It has no engine volume mounts.
Inspect `docker compose config` before deployment if your platform applies
resource limits differently. The container image does not include plotting,
data-science packages, package-management UI, or network access restrictions;
build your own derived image with explicitly chosen packages if needed.

## Develop locally

From the repository root, with Python 3.9 or later:

```sh
cd examples/plugins/python-notebook
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export MARGIN_PLUGIN_TOKEN="$(openssl rand -hex 32)"
.venv/bin/python server.py --check
.venv/bin/python server.py
```

The check reports `Dependencies and configuration ready` without opening a
listener. Starting the server prints its endpoint. Keep the token in this shell
for authenticated local protocol requests; do not use an engine API token.
Stop with Ctrl+C. After changing `server.py`, `runtime.py`, or `manifest.py`,
restart the service in the same shell to reuse the token. Kernels and their
variables are discarded on restart.

`--manifest` prints valid JSON without needing installed Jupyter dependencies or
a token, useful for inspecting the contract or validating it with other tools:

```sh
.venv/bin/python server.py --manifest > manifest.json
```

The generated file is a development artifact; the service serves the manifest
from `manifest.py`. Change that source and bump its version when you change a
capability, action, schema, or interface. Rebuild the package, uninstall the old
package, and install/enable the new one. Package refresh is not supported;
uninstall removes its runtime data, so save notebook outputs first.

Local mode runs code with your OS user's permissions. Prefer the dedicated
container for an owner-managed installation. `MARGIN_PLUGIN_HOST` defaults to
`127.0.0.1`; `MARGIN_PLUGIN_PORT` defaults to `8101`. The token must be at least
32 characters and is mandatory for every request, including `/manifest`.

## Use and save notebooks

Install the complete `.margin-plugin` file in **Settings → Integrations → Plugins**,
then enable it. Each notebook opens its own kernel when you run a cell. The
package’s editor can add, remove, reorder, and edit code or Markdown cells;
interrupt or restart the kernel; and import or download `.ipynb` files.

Execution outputs remain temporary until you choose **Save outputs**, then **Insert** or **Apply** in Margin.
Then save/publish the article in Margin to make those outputs visible to readers.
Reader mode cannot invoke execution actions. Closing the editor releases its
kernel through the generic host cleanup bridge. A failed session-creation response
also closes the unreturned kernel. Editor sessions use a 30-second owner lease,
renewed every five seconds while the editor is present. If the page disappears
without sending close, the service expires that lease and interrupts/stops the
kernel even during a running cell. The reaper checks once per second; cleanup
then allows a short interrupt grace before forcibly stopping a kernel.

Kernels are temporary: closing the session, service restart, or ten-minute idle
expiry loses Python variables and temporary files. Disabling/removing the package
stops the service and active kernels. Saved notebook JSON remains in the article;
viewing its rich interface requires the package to be installed and enabled.

## Develop the browser interface

From the repository root:

```sh
npm ci --prefix examples/plugins/python-notebook
npm test --prefix examples/plugins/python-notebook
node examples/plugins/python-notebook/build-ui.mjs /tmp/notebook.html
```

The generated document includes its scripts and styles and has no CDN or host
application imports. `build-package.py` runs this build automatically. UI changes
therefore travel inside the same versioned, verified package as the Python runtime.

## Execution boundaries

This first version runs **trusted publication-owner code only**. Do not expose
execution to readers or unknown authors. Each notebook has a Python kernel and
temporary working directory, but these processes share the service's OS user,
container, filesystem, and network privileges. They are not isolation boundaries
for hostile code. Clearing inherited environment variables avoids accidental
credential exposure; it does not prevent deliberately inspecting other processes
or files accessible to that user. Use a dedicated instance and credential per
Margin engine, and never put engine credentials, database files, host directories,
or a Docker socket in the plugin container.

## Actions and bounds

| Action | Input | Output |
| --- | --- | --- |
| `session.create` | `notebookId`, optional `managed: true` | `sessionId` |
| `session.heartbeat` | `sessionId` | `ok` |
| `cell.execute` | `sessionId`, `code` (empty cells allowed) | `outputs`, `executionCount` |
| `session.interrupt` | `sessionId` | `ok` |
| `session.restart` | `sessionId` | `ok` |
| `session.close` | `sessionId` | `ok` |

Requests use the protocol's `input` and server-provided `context` envelope.
Omitting `managed` keeps the API session’s existing ten-minute idle timeout.
Managed sessions expire 30 seconds after creation or their most recent successful
heartbeat; cell activity cannot extend this lease. Heartbeats require the session’s
owner/publication identity and cannot revive expired sessions. `session.close` is
idempotent, so unload cleanup and explicit close can safely overlap.

Sessions belong to the exact `(actorId, publicationId)` pair supplied by Margin.
An opaque session ID alone grants no access. Each kernel permits one execution
at a time; interrupt uses a separate request and can stop a running cell.

Defaults in `runtime.py` are four concurrent sessions, ten-minute idle expiry,
20-second cell wall time, 200 output records, and 192 KiB of serialized output.
The engine imposes its own 64 KiB JSON input and 256 KiB response limits, so the
effective code limit also includes JSON encoding overhead. Timeout and output
limit failures restart the kernel and clear variables. Interrupted code returns
its normal `KeyboardInterrupt` notebook output. Python exceptions are notebook
outputs, while transport/session errors use HTTP errors.

Only plain text, PNG display output, stream output, and Python error traces are
returned. HTML, JavaScript, widget comms, stdin prompts, arbitrary MIME renderers,
background jobs, persistent files, package installation, and public execution
are not supported product features. The service collects messages matching the
execute request until the kernel is idle, following Jupyter's
[messaging protocol](https://jupyter-client.readthedocs.io/en/stable/messaging.html)
and [client API](https://jupyter-client.readthedocs.io/en/stable/api/jupyter_client.html).

For mutually untrusted users, replace this executor with a service that provides
per-session containers or microVMs, dedicated credentials, enforced egress and
filesystem policies, quotas, and reliable process-tree cleanup. The generic
Margin protocol does not require Python or this executor design.

## Verify

```sh
python3 -m unittest discover -s . -v
MARGIN_PLUGIN_INTEGRATION=1 .venv/bin/python -m unittest discover -s . -v
```

The first command tests protocol validation, ownership, limits, message
correlation, concurrent interrupt, and cleanup with fake kernels. The opt-in
suite starts an HTTP listener and real kernels to verify authentication,
state across cells, empty cells, environment filtering, cross-publication
denial, interrupt, restart, time/output limits, and shutdown.

## Troubleshooting local development

| Symptom | Next step |
| --- | --- |
| `Missing Python dependencies` | Run `.venv/bin/python -m pip install -r requirements.txt`, then use that same interpreter to start the service. |
| `Set MARGIN_PLUGIN_TOKEN` | Generate a dedicated token as above and keep the same value in the service and Margin connection. |
| `Address already in use` | Stop the existing process or set `MARGIN_PLUGIN_PORT=8102` and connect that port. |
| Margin cannot connect | Test `/manifest` with the token from the engine's network; its `localhost` may be a different container. |
| Manifest changes do not appear | Check and refresh the connection in Margin, then enable the reviewed manifest. |
| Variables are missing | Run earlier cells again; restart, expiry, and execution limits clear the kernel. |
| Tests skip the real kernel | Run the second verification command with `MARGIN_PLUGIN_INTEGRATION=1` using the virtual environment. |
