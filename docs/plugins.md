# Build and install Margin plugins

A Margin plugin is an optional installable package containing its code and
runtime. The owner installs it from the directory or uploads it, reviews its actions and event subscriptions, then
enables it. Margin starts and stops the process. The engine host needs no
separate Node/Python installation, package manager, or plugin endpoint setup.

**Start with the [plugin quickstart](plugins-quickstart.md)** to scaffold, test,
package and install a typed plugin. The [package reference](plugin-packages.md)
covers archive layout, platform targets and other languages. This page describes
the language-neutral service protocol used internally between Margin and plugins.

Margin ships no optional plugin or language runtime by default. Each installed
package supplies its own executable. Packages run as child processes under the
engine service's OS account; they are trusted native code, not a sandbox.
Capabilities describe behavior rather than granting OS permissions. Review the
source and distributor of a package before enabling it.

## Install and manage

Use **Settings → Integrations → Plugins** while signed in as owner:

1. Choose **Browse plugins** for the official directory, or **Upload plugin** for
   a `.margin-plugin` archive matching the host target displayed by Margin.
2. Install it. The engine checks paths, hashes, target and manifest before storing
   it disabled; installation executes no plugin code.
3. Review capabilities, actions and event subscriptions, then enable. Margin
   starts the bundled executable with a private credential and local connection.
4. Review a newer release in **Browse plugins**, or use **Manage → Update package**
   for a local archive, to replace its code while retaining its data.
5. Disable to stop its process. Remove to delete the package and its data.

Enabled packages start with the engine and stop on shutdown. A failed runtime is
reported in Settings; re-enabling retries startup. Package updates retain the
plugin’s ID, persistent data directory and enabled state. Enabled updates restart
the service; failed startup restores the previous package and its data snapshot.
See [package updates](plugin-packages.md#update-an-installed-package) for recovery
and migration behavior. There is no automatic update or restart loop.

For development or an independently managed execution service, an advanced
service connection remains available. Connect its endpoint and dedicated token,
review and enable it. Refreshing that service's manifest disables it for review.
Removing an external connection does not stop the separately managed service.

## Official plugin directory

The directory is published in
[WritingMargin/margin-package](https://github.com/WritingMargin/margin-package).
Its reviewed `catalog.json` lists Jupyter notebook and Three.js scene packages;
the runtime archives live in versioned GitHub Releases. Browse shows the
publisher, version, features and compatible download size. Margin chooses the
package for the **engine server**, not the browser's platform. Plugins without a
verified build for that server remain visible but cannot be installed there.

Directory installation runs on the server. It downloads the reviewed release,
checks its full SHA-256 and byte size, validates its archive and manifest, then
uses the same managed installer as a manual upload. Browsing never executes
plugin code. Installation leaves the plugin disabled until the owner enables it.
Once enabled, choose **Plugin block** in the editor to use its supplied blocks.

The engine needs outbound HTTPS access to GitHub for browsing and downloading.
Manual package uploads remain available without the directory. Catalog or
download failures do not modify installed plugins. If a release changes after
review, reload its details before retrying. Directory updates use the same
version preconditions, managed-data snapshot and rollback as uploaded updates.
Updates are owner-initiated; Margin does not silently install catalog changes.

Operators may set `MARGIN_PLUGIN_CATALOG_URL` to an HTTPS catalog mirror without
credentials, a query string or redirects. Package downloads still must name
versioned releases in the official `WritingMargin/margin-package` repository.

Examples:

- [Python notebook package](../examples/plugins/python-notebook/README.md):
  a standalone Python interpreter with Jupyter dependencies and private kernels.
  The package build and engine execution are verified on macOS arm64.
- [Three.js scene package](../examples/plugins/three-scene/README.md): bundled
  Node, Three.js, a custom block editor and an interactive saved-scene reader UI.

The notebook package supplies its editor and saved-output reader. If it is
disabled or absent, Margin preserves the original notebook source as a fallback.
Live execution is restricted to the owner.

## Service protocol: `margin.plugin/v1`

Each launched plugin implements two endpoints on the host/port provided by Margin.
External services implement them below their configured base URL. Requests
include `Authorization: Bearer <token>` when a token was configured. The notebook
reference service requires authentication; other implementations should also
require a dedicated credential. Never reuse the engine's API token or expose
this credential to browser code.

`GET /manifest` returns an object like:

```json
{
  "apiVersion": "margin.plugin/v1",
  "id": "example-tools",
  "name": "Example tools",
  "version": "1.0.0",
  "description": "An independently installed example service.",
  "capabilities": ["text.analysis"],
  "actions": [{
    "name": "text.length",
    "title": "Count characters",
    "description": "Count characters in the supplied text.",
    "inputSchema": {
      "type": "object",
      "properties": {"text": {"type": "string", "maxLength": 10000}},
      "required": ["text"],
      "additionalProperties": false
    },
    "outputSchema": {
      "type": "object",
      "properties": {"characters": {"type": "integer", "minimum": 0}},
      "required": ["characters"],
      "additionalProperties": false
    }
  }]
}
```

`POST /actions/text.length` receives:

```json
{
  "input": {"text": "Hello"},
  "context": {
    "actorId": "1",
    "publicationId": "opaque-stable-publication-identifier"
  }
}
```

It returns:

```json
{"output": {"characters": 5}}
```

The engine constructs `context` after owner authentication. Browser action
requests contain only `input`; a browser cannot override `actorId` or
`publicationId`. A plugin should scope state to both identifiers. Publication
identity is persisted in the engine database. Treat identity as trustworthy only
on an authenticated engine-to-service request, and use distinct service
credentials and service instances for separate trust domains. A caller holding
a service credential can impersonate contexts, so these fields alone are not
multi-tenant authentication.

Return non-2xx status codes for service errors. The engine rejects those
responses with a generic plugin error rather than exposing arbitrary provider
error bodies. A successful action must return an object under `output` matching
the registered schema. Capabilities are descriptive declarations; they do not
grant database, filesystem, browser, or engine API access.

### Supported schema subset

Input and output roots must have `type: "object"`. Supported types are `object`,
`string`, `number`, `integer`, `boolean`, and `array`. The v1 subset supports:

- `properties`, `required`, `additionalProperties` (boolean only), and `items`.
- `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`.
- `title` and `description` annotations.

Unsupported keywords and malformed schemas are rejected during connection or
refresh. This is deliberately a bounded subset, not a full JSON Schema engine:
no `$ref`, unions, `oneOf`, regular expressions, remote schemas, defaults, or
schema coercion. Do not use unsupported keywords expecting them to be ignored.
The engine validates action input before sending it and output before returning
it to the client.

## Engine API

These routes require the owner's browser session. Public readers and OAuth/API
tokens cannot manage or run plugins in this first version.

| Route | Purpose |
| --- | --- |
| `GET /api/plugins` | List connections and validated manifests; tokens are omitted |
| `GET /api/plugins/directory` | Read the official catalog with the package matching this engine |
| `POST /api/plugins/directory/install/{id}` | Install reviewed `{version, sha256}`; initially disabled |
| `POST /api/plugins/directory/update/{id}` | Replace with reviewed `{version, sha256}` and installed-version `If-Match`; preserve managed data |
| `POST /api/plugins` | Connect `{endpoint, token?}`; initially disabled |
| `PATCH /api/plugins/{id}` | Update `{enabled?, token?}` |
| `POST /api/plugins/{id}/check` | Check service manifest and report available changes |
| `POST /api/plugins/{id}/refresh` | Replace cached manifest and disable pending review |
| `DELETE /api/plugins/{id}` | Remove registry entry and stored credential |
| `POST /api/plugins/{id}/actions/{action}` | Invoke with `{input: {...}}`, receive `{output: {...}}` |

Service tokens are encrypted using the engine's configured
`CONTENT_ENCRYPTION_KEY`. Public plugin records expose only whether a credential
is configured. Plugin traffic includes the submitted input and minimal author
context; it does not automatically include article data, database access, or
Margin credentials. The owner must choose which content to submit.

The engine limits action inputs to 64 KiB, responses to 256 KiB, manifests to
128 KiB, and service requests to 30 seconds. Calls do not automatically retry,
and redirects are rejected so credentials are not forwarded elsewhere. Build
longer workflows as bounded start/status/cancel actions rather than holding a
request open beyond the deadline. Plugins must enforce their own work, output,
concurrency, session, and cleanup limits.

HTTPS is required for public endpoints. Plain HTTP is restricted to private or
loopback addresses and resolved addresses are checked at connection time. A
container's `localhost` means that container; use a private service address
reachable from the engine. Keep execution services private, authenticated, and
separate from core engine credentials and storage.

## Notebook capability

The Python package declares a `notebook` block and the `notebook.execute`
capability. Its actions are `session.create`, `cell.execute`, `session.interrupt`,
`session.restart`, and `session.close`; the reference manifest is in
[`manifest.py`](../examples/plugins/python-notebook/manifest.py). Notebook results
use the familiar `stream`, `execute_result`, `display_data`, and `error` output
objects plus an execution count. The reference service limits display data to
plain text and PNG. The engine still treats responses as untrusted data; plugins
cannot install arbitrary frontend scripts through action responses.

Its packaged UI imports, edits, executes and exports Jupyter v4 notebooks.
The block editor can explicitly save outputs into the notebook JSON, which the
author commits with Insert/Apply before saving the article. Runs in the owner
preview remain temporary. Readers see saved cells and outputs without execution
controls. Parsing, cell controls, output rendering and session management all
belong to the plugin; Margin has no dedicated notebook renderer.

The manifest declares `languages: ["ipynb"]` so existing code fences can use the
same UI without rewriting stored articles. Editing and applying a legacy block
converts its fence to `plugin:python-notebook:notebook`. This alias mechanism is
generic; if multiple enabled blocks claim a language, Margin preserves source
instead of choosing one implicitly.

This is trusted-owner execution, not a public notebook hosting sandbox. Kernel
process separation and a resource-limited plugin container protect operational
boundaries but do not isolate hostile code within the service. Before supporting
reader execution or unrelated authors, provide a dedicated execution platform
with enforced per-session isolation, network and filesystem policy, resource
accounting, and reliable teardown. None of those future changes require adding
Python to the core Margin engine.

## Three.js capability

The Three.js package declares a `scene` editor block and a `scene.execute`
action. Its request supplies `{ code }`; the response contains validated scene
data, camera settings, animation clips and console output. The package supplies
the editor, validation and renderer. Margin hosts it through the generic
[plugin block interface](plugin-blocks.md), with no Three.js-specific integration.

The reference plugin supplies `THREE`, `scene`, `camera`, `target`, `animations`
and `console`. It supports geometry, materials, lights and keyframe animations;
DOM APIs, custom shaders and external textures are outside its current contract.
Execution is restricted to the owner. In the block editor, **Save scene** stages
a snapshot, and **Insert/Apply** commits it to the article. Published blocks can
render and animate that saved scene without executing author JavaScript. Runs in
the owner's article preview remain temporary. Like the notebook executor, the
backend runs trusted-owner code and is not a hostile-code sandbox.

See the [Three.js guide](../examples/plugins/three-scene/README.md) for the
complete authoring example, limits and package build commands.

## Plugin-owned blocks and UI

Packages may declare up to 16 blocks, each with a bundled HTML entry, a default
source and an action allowlist. The owner can insert/edit these through the
**Plugin block** picker. `reader: true` enables the package's UI on public
articles; public views can render saved data but cannot execute backend actions.
See the [block SDK and packaging guide](plugin-blocks.md).

| Route | Purpose |
| --- | --- |
| `GET /api/plugin-blocks` | Public descriptor registry for enabled reader blocks |
| `GET /api/plugin-blocks/{id}/{block}` | Verified packaged HTML as JSON; owner session required for private blocks |
| `GET /api/plugin-blocks/{id}/{block}/frame` | Verified HTML with an HTTP sandbox policy forcing opaque-origin execution |
| `POST /api/plugins/{id}/blocks/{block}/actions/{action}` | Owner-only invocation restricted to the block's declared actions |

These routes never grant plugin HTML same-origin execution. Margin places
the UI into an isolated frame with a dedicated message bridge. Block source is
preserved if its package is unavailable. External services cannot supply UI.
