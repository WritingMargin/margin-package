# Build your first Margin plugin

A Margin plugin is a portable browser component. It supplies its editor and reader
UI, stores article content through the browser SDK, and can call a service through
Margin's built-in HTTP bridge when needed. No runtime is installed on the Margin
server.

Use Node.js 24 or later on your development machine to run the SDK tools. The SDK
is included in this repository; it is not currently published to npm.

## Create, check and package

From this repository's root:

```sh
node packages/plugin-sdk/create.mjs create my-margin-plugin
cd my-margin-plugin
npm test
npm run check
npm run pack
```

The generated browser component is the starting point. Edit its interface and
manifest, then package it as a `.margin-plugin`. The archive contains browser
assets and metadata, not your development runtime or `node_modules`.

Open **Settings → Integrations → Plugins → Upload plugin** in Margin, choose the
archive, review it and enable it. In the editor, choose **Plugin block**, then
select the block supplied by your package.

## Connect to Margin

Your bundled browser entry uses `connectBlock()`:

```js
import { connectBlock } from '@margin/plugin-sdk/browser';

const client = await connectBlock();
const model = JSON.parse(client.context.source || '{}');

// Call this from your editor controls when their value changes.
function save(nextModel) {
  if (client.context.mode === 'edit') {
    client.change(JSON.stringify(nextModel));
  }
}
```

Read mode displays the saved source. Preview mode lets the owner try the
component without editing the article. Keep rendering and browser computation
inside your component; Margin does not need a custom renderer for each plugin.

## Add a “Try it” API interaction

Declare an action in the manifest with a stable name, explicit JSON schemas and
a fixed HTTP method/path. List that action in the block's `actions` array. See the
complete [`estimate` declaration](plugins.md#interactions-with-your-server).

```js
// Use this inside the button's click handler.
const result = await client.action('estimate', { quantity: 3 });
```

The owner configures the API's public HTTPS base URL and API key in Margin's
plugin settings. The plugin never asks for, stores or receives the key. Margin
sends the input JSON to the declared path and returns the validated result.
Your service can use any language and is deployed independently of Margin.

To offer the interaction to readers, declare `http.reader: true`, provide a reader
view, and have the owner explicitly enable reader access. Check
`client.context.actions` before showing a remote action button. Without permission,
show the saved results or a clear unavailable message.

## Update your plugin

Keep its ID stable, increment the version, run checks and package again. Choose
**Update package** in Margin or publish the new portable archive through the
plugin directory. Existing article source and API connection settings remain.
Updates accept current-format packages only and never execute migration scripts.

Before releasing, test editor changes, reader rendering, disabled or missing
connections, HTTP errors and package replacement. Never place secrets in package
files or article source. See the [package format](plugin-packages.md) and
[block SDK](plugin-blocks.md) for the full contract.
