# Package a plugin for Margin

A `.margin-plugin` file is a ZIP archive containing a validated plugin manifest,
a platform target, an executable, its dependencies, and a hash for every payload
file. Margin installs it without executing code, then starts the declared
executable when the owner enables the plugin. Language runtimes belong to the
package, not the core Margin distribution or the operator's system packages.

Packages can also include self-contained HTML interfaces for their own editor
blocks and reader views. The manifest declares each block, and its HTML is
hashed with the rest of the payload. See [plugin-owned blocks](plugin-blocks.md)
for the SDK, file paths and isolated browser bridge.

Owners can install official packages through **Browse plugins**, or use
**Upload plugin** for a local archive. The official catalog is maintained in
[WritingMargin/margin-package](https://github.com/WritingMargin/margin-package),
with per-platform archives attached to versioned GitHub Releases. Directory
downloads additionally verify the complete archive's reviewed SHA-256 and byte
size before applying this package contract.

Managed packages currently require a **single Margin engine process**. Do not
run several engine replicas against the same plugin records: each replica could
restore the package independently and replace its connection details. Use
external plugin services for replicated Margin deployments.

## Package a Node plugin

The generated starter includes:

```sh
npm test
npm run check
npm run pack
```

The pack command bundles `plugin.ts`, `server.ts`, a minimal app `package.json`,
the SDK's runtime files, the current Node executable, and its distribution
LICENSE. Node 24 runs the TypeScript directly; there is no bundler or compiler
step. The default filename contains plugin ID, version, OS and architecture.
Existing files are never overwritten. `.env`, tests, npm development tools and
the rest of your checkout are not part of the default bundle.

For extra app modules or assets, explicitly list them in your project:

```json
{
  "margin": {
    "files": ["plugin.ts", "server.ts", "lib", "assets/template.txt"]
  }
}
```

The list must include the plugin source and entry. Directories are traversed
without following symlinks. The SDK's intentional local npm link is resolved
explicitly and its runtime files are copied as regular files. Known secret paths
such as `.env`, private-key files and `.git` are refused. Filenames cannot reveal
all sensitive content: inspect your chosen app files and do not embed credentials.

Automatic Node packaging supports the SDK dependency only. For additional npm
production dependencies, bundle your app into plain JavaScript or stage a full
payload with the needed dependency files, then use prebuilt mode below. The
packer never guesses which parts of an arbitrary `node_modules` tree to ship.

## Build for another host

Margin shows its target, such as `linux/arm64` or `darwin/amd64`, in Plugins.
Build a matching package. The packer defaults to the current host and checks the
Node binary's ELF or Mach-O architecture against the declared target.

```sh
npm run pack -- --runtime /path/to/node-linux-arm64/bin/node --os linux --arch arm64
```

Use the complete official Node distribution for that target. Its `LICENSE` is
normally found beside `bin`; otherwise pass `--runtime-license /path/to/LICENSE`.
Do not rename your current binary to claim another platform. Foreign binaries
cannot be smoke-tested on the developer host: test the resulting package on a
matching host before sharing it. Native dependencies must match that host too.
An operating system's baseline C libraries still need to be compatible with the
chosen runtime; a package is not a portable virtual machine.

## Package another runtime

A Go/Rust executable or a prepared Python runtime can use the same format. Stage
only distributable regular files in a payload directory and export the service's
manifest to JSON. For example:

```text
payload/
  runtime/my-plugin
  runtime/LICENSE
  app/config.json
manifest.json
```

From a Margin checkout:

```sh
node packages/plugin-sdk/pack.mjs \
  --directory /path/to/payload \
  --manifest /path/to/manifest.json \
  --executable runtime/my-plugin \
  --args '["app/config.json"]' \
  --os linux --arch amd64 \
  --output my-plugin-linux-amd64.margin-plugin
```

`--directory` copies that payload, not the surrounding project. Symlinks, special
files, unsafe paths and known secret files are refused. The launch executable
must be a listed regular file. Arguments are passed directly without a shell.
The process working directory is the package root.

The [Python notebook builder](../examples/plugins/python-notebook/README.md#build-an-installable-notebook-package)
provides a working example: it copies a relocatable standalone Python distribution,
installs the pinned Jupyter dependencies into that copy, removes build-only command
wrappers, and packages it. Both the HTTP service and every kernel use the bundled
interpreter explicitly; no host Python or installed kernelspec is consulted.

The reference package was verified on **macOS arm64 with standalone CPython
3.12.14**, ipykernel 6.29.5 and jupyter_client 8.6.3. Actual engine tests ran with
an empty PATH and exercised stateful execution, errors, images, interrupt,
restart, four-kernel shutdown, re-enable, engine restart and uninstall. This does
not claim a tested Linux or amd64 binary: run the platform build and the same
smoke test on each target before distributing it. A different Python plugin can
use the same standalone-interpreter layout or a separately verified frozen build.

## Runtime contract

Margin supplies a minimal process environment:

| Variable | Purpose |
| --- | --- |
| `PLUGIN_TOKEN` | Random engine-to-plugin authentication credential |
| `PLUGIN_HOST`, `PLUGIN_PORT` | Private listener chosen by Margin |
| `PLUGIN_DATA_DIR` | Persistent writable data directory for this installation |
| `HOME`, `TMPDIR` | Directories within the plugin's data area |
| `PATH` | Empty; launch bundled executables by explicit path |

The equivalent `MARGIN_PLUGIN_TOKEN`, `MARGIN_PLUGIN_HOST`,
`MARGIN_PLUGIN_PORT`, and `MARGIN_PLUGIN_DATA_DIR` aliases support the Python
reference's naming convention. Engine credentials are not inherited. Child
process isolation is not a hostile-code sandbox: packages execute with the
service user's OS privileges. Use an external sandboxed execution platform for
untrusted user code.

Listen on the supplied host/port, authenticate with the supplied token, and
serve the manifest matching the installed package. Startup readiness has a
ten-second deadline. Store durable plugin state in `PLUGIN_DATA_DIR`; do not
modify package files, which are hash-checked before each launch. The launch
executable and files marked executable in the source payload receive sanitized
owner-only executable permissions. Other files receive owner-only read/write
permissions; setuid and other archive permission bits are not preserved.

Disabling sends SIGTERM for graceful cleanup, then force-stops the process
group after two seconds if needed. Removing deletes its package and data.
The engine restarts enabled packages on its next startup. Failed runtimes are
shown as failed rather than restarted indefinitely; the owner can retry enable.
Managed stdout and stderr are discarded in this version. Startup failures expose
a generic runtime error rather than a log viewer. Reproduce failures by unpacking
and running the package on a matching development host with the documented
environment, then verify its authenticated `/manifest` response.

## Update an installed package

Choose **Manage → Update package** in the plugin’s settings. Upload a trusted
archive for the same plugin ID and host target with a different version. Margin
validates the archive before stopping the existing service, preserves its stable
`PLUGIN_DATA_DIR` / `MARGIN_PLUGIN_DATA_DIR` location, and keeps its enabled state.
A disabled plugin stays disabled; its replacement code is not executed during
update. An enabled plugin restarts, ending in-memory work and active sessions.

Before swapping files, Margin saves the old package metadata and a snapshot of
its data directory. If the new service fails readiness, Margin stops it, restores
the previous package and data, and attempts to restart the previous enabled
version. A durable update journal allows recovery after the engine is interrupted.
The rollback copy is removed after a successful update. Sufficient temporary disk
space is required for both the replacement and data snapshot. The snapshot accepts
regular files and directories, up to 2 GiB and 100,000 entries. Links and special
files are rejected rather than followed; a snapshot failure leaves the old
package installed.

Keep durable state in the supplied data directory. Files written inside the
package are not persistent and are replaced on update. Plugins own their schema
migrations: make startup migrations transactional and compatible with the version
being installed. Rollback covers the managed data directory, not external files,
remote databases or side effects performed by plugin code. Version strings must
differ, but Margin does not infer upgrade ordering from them; a manually installed
older version must be able to read the retained data itself.

The owner-only endpoint is `POST /api/plugins/{id}/package` with
`Content-Type: application/zip` and `If-Match` identifying the installed version.
A raw version or quoted version is accepted; JSON-escaped quoted values allow
non-ASCII version strings to travel in HTTP headers. A successful update returns
the updated plugin with status 200. Missing preconditions return 428; a stale
version returns 409. Reload the plugin before retrying a conflict or an upload
whose connection was interrupted. The existing install endpoint continues to
reject duplicate plugin IDs instead of silently updating them.

## Publication hooks

Plugins can subscribe an action to publication events:

```ts
hooks: [{ event: "post.published", action: "publication.published" }]
```

The action must exist in the same manifest. The current event is emitted for
committed published article/guide revisions, including updates. Its input is:

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "event": "post.published",
  "post": {
    "id": "post-uuid",
    "title": "An idea worth sharing",
    "slug": "an-idea-worth-sharing",
    "status": "published",
    "contentType": "article",
    "revision": "revision-id"
  }
}
```

All six post fields are strings. Hooks receive metadata, not article bodies.
Delivery retries may repeat an event; use `eventId` to make handling idempotent
and scope state to `context.publicationId` and `context.actorId`. Store durable event records in the supplied plugin data directory.

Only enabled plugins receive new events. The queue commits with the published
revision and retries failed deliveries up to three attempts. Package updates
retain queued deliveries when the replacement declares the same event and action
and accepts the queued input. Removed or incompatible subscriptions are skipped;
disabling a plugin or refreshing an external service with a changed manifest
also skips its queued events. The owner can inspect the
twenty most recent deliveries in **Manage → Recent activity**; terminal events
are retained for seven days. Each plugin can have up to 1,000 pending/running
events; when that queue is full, new hook events are dropped and logged while
publication continues. Handlers should return promptly and keep their own
durable records when they need longer retention.

## Archive format and limits

`margin-package.json` has this shape:

```json
{
  "packageVersion": "margin.package/v1",
  "plugin": {"apiVersion": "margin.plugin/v1", "id": "example", "name": "Example", "version": "1.0.0", "description": "...", "capabilities": [], "actions": []},
  "target": {"os": "linux", "arch": "amd64"},
  "launch": {"executable": "runtime/node", "args": ["app/server.ts"]},
  "files": {"runtime/node": "sha256-hex-digest", "app/server.ts": "sha256-hex-digest"}
}
```

This abbreviated shape illustrates fields; real plugin manifests need at least
one action and real digests are 64 lowercase hex characters. The `files` map
covers every payload file, excluding `margin-package.json`. No duplicate paths,
case-insensitive collisions, absolute paths, traversal, links, or special files
are allowed. Supported targets are Linux/macOS on amd64/arm64.

Limits are 256 MiB archive size, 768 MiB expanded payload, 20,000 ZIP entries,
and 4 MiB package metadata. The SDK writer uses uncompressed ZIP entries to avoid
an archiver dependency, so its practical payload limit is under 256 MiB including
overhead. Another builder may use a compatible compressed ZIP within all engine
limits. Hashes detect file changes and corruption; they do not establish a
publisher's identity or replace a signature/trust decision.

API routes require the owner's browser session:

- `GET /api/plugins/host` reports the package target and support.
- `POST /api/plugins/packages` accepts the raw archive as `application/zip` and
  stores the plugin disabled.
- `GET /api/plugins/{id}/events` returns recent delivery status without payloads.
- Existing enable/disable/remove action routes manage its lifecycle.

For SQLite, package storage lives beside the database in `plugins`. PostgreSQL
installations must configure `MARGIN_PLUGIN_DIR` on persistent storage. Include
plugin data in the operator's backup plan if a plugin keeps durable state.
