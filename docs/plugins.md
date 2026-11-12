# Plugins

Margin plugins are optional browser components. A plugin can add its own editor
blocks, reader interface and interactions without changing Margin's core. No
plugins are installed by default, and Margin does not install or launch Node.js,
Python, Jupyter kernels or any other plugin execution engine.

A portable `.margin-plugin` contains a manifest and browser assets. It works on
any operating system supported by the Margin host. The package's interface runs
in an isolated browser frame, with no direct access to publication credentials,
cookies or network connections.

## Install and use

Open **Settings → Integrations → Plugins → Browse plugins**. Choose a plugin,
review what it adds, then install and enable it. Its blocks appear in the editor's
**Plugin block** menu. **Upload plugin** accepts the same portable package format.

The official directory is maintained in
[WritingMargin/margin-package](https://github.com/WritingMargin/margin-package).
The catalog describes each plugin and pins a versioned GitHub Release archive by
SHA-256 and byte size. Margin checks those values and the package contents before
installation. Browsing and installation do not execute package code on the server.

Updates replace browser assets while preserving the plugin identity, HTTP
connection settings and saved article source. They require the installed version
in `If-Match`, so a stale screen cannot overwrite another update. Failed file or
database updates restore the previous package. Nothing updates automatically.

## Interactions with your server

Use Margin's built-in HTTP bridge when a component needs an external service:

1. The plugin declares a named action, fixed HTTP method and path, and input and
   output JSON schemas.
2. The publication owner configures the service's public HTTPS base URL and,
   optionally, an API key in the plugin's settings.
3. The component calls `client.action(name, input)` through the browser SDK.
4. Margin validates the action and input, attaches the saved credential on the
   server, calls the configured service and validates its JSON response.
5. The component displays the returned result.

For example, a pricing calculator can POST its form values to your `/estimate`
endpoint and display the returned estimate. Your endpoint can be written in Go,
JavaScript, Python or any other language; it runs on your infrastructure.

```json
{
  "name": "estimate",
  "title": "Try an estimate",
  "inputSchema": {
    "type": "object",
    "properties": { "quantity": { "type": "number", "minimum": 1 } },
    "required": ["quantity"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": { "total": { "type": "number" } },
    "required": ["total"],
    "additionalProperties": false
  },
  "http": { "method": "POST", "path": "/estimate", "reader": true }
}
```

POST sends the input object directly as JSON; the service returns a JSON object
directly. GET actions have a fixed path and accept an empty input object. The
plugin does not provide a destination URL or authentication headers at call time.

API keys are encrypted at rest and never included in the browser's configuration,
article source or plugin frame. The default credential format is
`Authorization: Bearer <key>`; a custom API-key header and prefix can be configured.
Requests use public HTTPS port 443, reject private/reserved DNS addresses, and do
not follow redirects. This bridge is not a general-purpose open proxy.

## Reader-facing “Try it” buttons

Reader access is off by default. An action must declare `http.reader: true`, be
listed in a reader block's `actions`, and be explicitly enabled for readers by
the owner in the HTTP connection settings. Reader actions are public interactions:
any visitor may use them, and the upstream service may charge for their use.
Only expose endpoints and input schemas suitable for that audience.

Margin enforces same-origin requests, per-reader rate limits, concurrent request
limits, a 20-second HTTP timeout, 64 KiB action inputs and 256 KiB responses.
Readers cannot edit article source, import files into the editor or invoke
undeclared owner-only actions. They receive action results, never the API key.

## Initial plugins

- **Three.js scenes:** a browser code editor and interactive scene viewer.
  Code runs in a browser worker with an execution timeout; no Node.js server is
  needed. Rendering and interactivity use the reader's browser.
- **Jupyter notebook:** a browser notebook editor, `.ipynb` import/export and
  saved-output reader. Executing Python requires an independently hosted HTTP
  service configured by the owner. Margin does not start a local Python kernel.
  The example service source is supplied separately for deployment on your server.

## Supported contract

Margin accepts only the current portable package and browser SDK contract.
Earlier executable packages, external plugin-wire services and language aliases
are unsupported. There are no migration adapters or runtime fallbacks. Blocks
use the canonical `plugin:<plugin-id>:<block-id>` fence identifier.

## Reference

- [Create a plugin](plugins-quickstart.md)
- [Package format and updates](plugin-packages.md)
- [Editor and reader block SDK](plugin-blocks.md)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/plugins` | Owner's installed packages; no secrets |
| `GET /api/plugins/host` | Package format and upload availability |
| `POST /api/plugins/packages` | Upload a portable ZIP as `application/zip` |
| `PATCH /api/plugins/{id}` | Enable/disable or configure the HTTP connection |
| `POST /api/plugins/{id}/package` | Update an installed package with `If-Match` |
| `GET /api/plugins/directory` | Browse the official portable package catalog |
| `POST /api/plugins/directory/install/{id}` | Install reviewed `{version, sha256}` |
| `POST /api/plugins/directory/update/{id}` | Update reviewed `{version, sha256}` with `If-Match` |
| `GET /api/plugin-blocks` | Enabled reader blocks and permitted reader action names |
| `POST /api/plugins/{id}/blocks/{block}/actions/{action}` | Owner block action |
| `POST /api/plugin-blocks/{id}/{block}/actions/{action}` | Explicitly allowed reader HTTP action |

Management requires an owner browser session. API/OAuth tokens cannot configure
plugin credentials or bypass reader permissions. Operators may set
`MARGIN_PLUGIN_CATALOG_URL` to a non-redirecting HTTPS catalog mirror; archive URLs
must still name versioned releases in the official package repository.
