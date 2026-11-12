# Ship an editor block with your plugin

A packaged plugin can bring its own editor, preview and reader UI. Margin
discovers the block from the installed manifest; adding a new block does not
require adding a React component, language switch or renderer to Margin.

## Start with a working block

From the repository root, using Node.js 24 or later on the developer machine:

```sh
node packages/plugin-sdk/create.mjs create my-block --block
cd my-block
npm test
npm run check
npm run pack
```

Install and enable the resulting `.margin-plugin` file in **Settings →
Integrations → Plugins**. In an article's writing toolbar, choose **Plugin
block**, select **Writing card**, and use its custom editor. **Insert block** or
**Apply changes** commits the block's source to the article. Cancelling the
dialog leaves the article unchanged.

The starter includes `block.html`, an editable, self-contained UI with the
browser SDK inline. It also includes a typed `text.count` backend action and
the package file list. Change the block UI and backend independently, then ship
both together. No endpoint or host Node installation is needed after packaging.

For a complete 3D example, see the [Three.js plugin](../examples/plugins/three-scene/README.md).
Its geometry validation, editor, renderer, orbit controls and animation controls
are all supplied by the package.
The [Python notebook plugin](../examples/plugins/python-notebook/README.md)
likewise supplies notebook import/editing, execution, output rendering and export.

## Declare the block

Add `blocks` to the manifest passed to `definePlugin`:

```ts
blocks: [{
  id: "writing-card",
  title: "Writing card",
  description: "A space for your words.",
  entry: "app/block.html",
  defaultSource: '{"text":"Hello Margin"}',
  actions: ["text.count"],
  reader: true,
}]
```

`entry` is an exact path inside the archive, not a URL. In the SDK's automatic
Node packer, `margin.files: ["plugin.ts", "server.ts", "block.html"]` places the
HTML at `app/block.html`. A prebuilt payload uses the paths inside that payload
directly. The file is covered by the package's SHA-256 hashes.

Block IDs are unique within the plugin. Each block can call only its declared
`actions`, which must also exist in the plugin's action list. `reader: true`
allows the UI to render saved block data on public articles. It grants no public
backend execution. Omitting it keeps the UI limited to the owner workspace.

Optional `languages: ["legacy-format"]` declares up to eight code-fence aliases
for existing documents. Aliases use lowercase letters, numbers and hyphens and
must be at most 32 characters. An alias is used only when exactly one enabled
package block claims it; built-in code languages keep their existing behavior.
The plugin receives the existing source unchanged. Applying an edit replaces
the legacy fence with the canonical namespaced fence. This lets a package
support older content without registering custom parsers in Margin.

The article stores a namespaced fenced block:

````markdown
```plugin:my-block:writing-card
{"text":"Hello Margin","words":2}
```
````

The content inside is a string owned by your plugin. JSON is convenient, but
not required. Preserve old source formats when upgrading your UI. If the plugin
is missing, disabled or fails to load, Margin retains the source and provides a
fallback instead of deleting the author's work.

## Connect the UI

For a bundled UI, import the browser-only SDK:

```ts
import { connectBlock } from "@margin/plugin-sdk/browser";

const block = await connectBlock();
const { mode, source, theme } = block.context;
const value = JSON.parse(source);

// A click in your editor or preview can run a declared action.
const result = await block.action("text.count", { text: value.text });

// Only edit mode can stage source. Margin's Apply button commits it.
if (mode === "edit") {
  block.change(JSON.stringify({ ...value, words: result.words }));
}
block.resize(360);
```

In actual UI code, expose action calls through controls and handle errors. Do
not call actions when `mode === "read"`; the host rejects them. An optional
`{ signal }` argument to `action` lets a Stop button cancel a request. Call
`close()` when disposing the UI to cancel pending work and close its port.

For resource-backed blocks, call `setCleanup("session.close", { sessionId })`
after creating the resource. Margin invokes that one declared action when the
frame closes, including editor cancellation and preview unmount. Re-registering
replaces the pending cleanup; `setCleanup(null)` clears it after explicit
release. Cleanup is owner-only and has a 4 KiB input bound. The host uses a page-exit
beacon, falling back to a keepalive request with a five-second deadline.
Browser/network shutdown can still interrupt delivery,
so services must retain idle expiry as a fallback.

To export content, call `download("document.json", "application/json", text)`.
Margin offers a **Download document.json** button outside the sandbox; the user
clicks it to save the file. Downloads are limited to 1.5 MiB of text with a plain
filename and MIME type. Reader blocks can offer exports too. The plugin never
receives filesystem access or permission to create automatic downloads.

| Mode | Purpose | Backend actions | Source changes |
| --- | --- | --- | --- |
| `edit` | Plugin editor dialog | Declared actions only | Staged until Insert/Apply |
| `preview` | Owner's article preview | Declared actions only | Rejected |
| `read` | Public article | Rejected | Rejected |

`theme` provides `background`, `foreground`, `muted`, `accent`, `border` and
`fontFamily` values from Margin. Use them as CSS variables so your UI fits the
publication. Supply accessible labels, keyboard controls and responsive layout
inside your document. `resize(height)` requests a height between 180 and 1000px.

There is no implicit save of execution results. A plugin can offer **Save
result** in its editor, encode the result in source, and stage it with
`change()`. Once the author applies and saves the article, the reader UI can
display that snapshot without running backend code. The Three.js reference
uses this flow for published interactive scenes.

## Build the browser payload

Bundle your JavaScript, framework, styles and dependencies into one HTML
document with inline scripts and styles. React, Vue or plain JavaScript are
implementation choices inside the plugin. There are no runtime imports from
Margin's React tree. Embed images as data URLs where needed; external scripts,
styles, fonts, network requests and nested frames are blocked.

Margin serves verified HTML through a dedicated frame route. Both its HTTP
Content Security Policy (`sandbox allow-scripts`) and the iframe's
`sandbox="allow-scripts"` attribute force an opaque origin. Inline scripts are
allowed only on this isolated response; Margin's page policy stays unchanged. It
cannot access the parent DOM, cookies, storage or service token. The host
verifies the frame before transferring a dedicated MessagePort, then checks
the block's mode, action allowlist, payload size and pending requests. The
backend independently checks the owner session and block action allowlist.

These browser restrictions do not sandbox a plugin's native backend process.
Install packages from developers you trust. Public reader execution of backend
actions is intentionally outside this API.

## Bounds and lifecycle

- At most 16 blocks per plugin; the complete manifest remains limited to 128 KiB.
- HTML entry: UTF-8, at most 4 MiB, listed in the package and verified on load.
- Default source: at most 48,000 Unicode characters.
- Edited source: at most 1.5 MiB, subject to the article's overall content limit.
- Actions retain the engine's 64 KiB input, 256 KiB output and execution limits.
- Disabling/removing the package removes its blocks from discovery and blocks
  further action calls. Existing article source remains intact.

UI contributions require a package. External service connections can still
supply actions and hooks but cannot supply browser UI. Global admin pages,
toolbars, arbitrary application hooks and public backend execution are not
extension points in this version.

The frame route is `/api/plugin-blocks/{pluginId}/{blockId}/frame`. It never
grants same-origin execution, even if opened directly. The sibling JSON route
without `/frame` remains available for inspecting the verified HTML payload.

### Shared select control

Margin’s `Select` component and plugin UIs use the same stylesheet, exported as `@margin/plugin-sdk/select.css`. Bundle it into the block HTML and add `class="margin-select"` to a native `<select>`. This keeps native keyboard and mobile menus with Margin’s standard caret and spacing. Customize `padding-block`, `padding-inline-start`, or `background-color` when needed; leave end padding and caret placement to the shared stylesheet. The notebook and Three.js packages show this build step.

### Import a local text file

In an editor block, call `await client.importTextFile({ accept: ".ipynb,application/json", maxBytes: 1500000 })`. Margin displays a native file picker in the host interface; the author chooses the file explicitly. The result is `{ name, text }`, or `null` when cancelled. Only the chosen file's text is shared with that block. The API is unavailable in preview and reader modes, accepts one pending request per block, and checks file size and UTF-8 size up to 1.5 MiB. Closing the block cancels pending reads and discards late results. Plugins remain responsible for validating the imported format.

### Resource ownership across page exits

Browser cleanup requests can be lost when a page or process disappears. Long-lived plugin resources should also have a server-enforced lease. The notebook package creates managed sessions, renews them every five seconds through its declared `session.heartbeat` action, and expires them after 30 seconds without renewal. Its reaper interrupts and stops an expired kernel even while code is executing. This ownership protocol belongs to the plugin; Margin continues to expose only scoped generic actions.
