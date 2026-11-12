# Make something useful for a writer

The Margin plugin SDK lets you turn a small function into a tool a writer can use in their publication. You describe its inputs and result, write the function, and let the runner handle the connection.

Plugins are optional installable packages. The SDK bundles your code and a Node
runtime into a `.margin-plugin` file; Margin manages its process after the owner
enables it. The engine host needs no installed Node, npm, or manually configured
endpoint. The SDK has no runtime dependencies and is **not published to npm**.

## Your first plugin

For a plugin with its own editor and reader UI, use `create my-plugin --block`.
The generated `block.html` and its manifest declaration travel with the package.
See [custom blocks](../../docs/plugin-blocks.md) for the browser API, saved
results, isolated rendering and a Three.js example.

Use Node.js 24 or later on your development machine. From your projects folder:

```sh
node /path/to/Margin/packages/plugin-sdk/create.mjs create my-plugin
cd my-plugin
npm test
npm run check
npm run pack
```

Install the resulting `.margin-plugin` file in **Settings → Integrations →
Plugins**, review its capabilities and enable it. Try **Count my words** in its
developer tools with `{"text":"Hello Margin"}`. The package defaults to your
computer's OS and architecture; match the target displayed by Margin.

The generator installs this SDK from its local filesystem path without registry
access. The archive contains the needed SDK files, app and Node runtime/license.
It excludes the generated development `.env`. For a local editing loop,
`npm run dev` starts a watched service; connecting that endpoint is optional.

See the [quickstart](../../docs/plugins-quickstart.md) and
[package guide](../../docs/plugin-packages.md) for cross-target runtimes,
explicit app file selection, other languages and lifecycle behavior.

The starter contains:

| File | What you change |
| --- | --- |
| `plugin.ts` | Your actions, their descriptions, and the code they run |
| `plugin.test.mjs` | Examples that show what your action should do |
| `server.ts` | Starts the SDK runner |
| `.env` | Your private token, listening address, and port |
| `package.json` | Commands and the local SDK dependency |

Run `npm test` to exercise the action. Run `npm run check` to validate the manifest and schemas. `npm run check -- --json` prints the manifest you will share with Margin. A failed check exits with a nonzero status.

Node strips TypeScript syntax when running the starter; it does **not** perform a TypeScript compile check. An editor with TypeScript support provides inferred types. Teams using TypeScript in CI can also run their own `tsc --noEmit` check with TypeScript and Node type declarations installed. The SDK repository tests its declarations with a separate compile check.

## Write an action

```ts
import { defineAction, definePlugin, startPlugin } from "@margin/plugin-sdk";

const count = defineAction({
  name: "text.count",
  title: "Count my words",
  description: "See how much you have written. Your text is not stored.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", maxLength: 12000 } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { characters: { type: "integer", minimum: 0 } },
    required: ["characters"],
    additionalProperties: false,
  },
  handler(input, context) {
    // input.text is inferred as string; the result must contain a number.
    context.signal.throwIfAborted();
    return { characters: [...input.text].length };
  },
});

const plugin = definePlugin({
  id: "my-writing-tools",
  name: "My writing tools",
  version: "0.1.0",
  description: "Small tools for a thoughtful writing practice.",
  capabilities: ["text.analysis"],
  actions: [count],
});

// PLUGIN_TOKEN must be configured; the generated starter supplies .env.
await startPlugin(plugin);
```

You can add several actions with different input and result types. Keep handler logic independent of HTTP so you can call `action.handler(input, context)` in ordinary tests. Direct calls skip runtime validation; `createPluginServer` and `startPlugin` validate incoming input and outgoing results.

`definePlugin` validates and freezes a snapshot of the manifest. After you change an action or schema, build a new package version and install it in Margin. External development connections use manifest refresh.

## The small API

- `defineAction({ ...metadata, inputSchema, outputSchema, handler })`: infer TypeScript handler types from literal schemas.
- `definePlugin({ id, name, version, description, capabilities, actions })`: validate and freeze a plugin definition. Its `.manifest` contains no handler code.
- `startPlugin(plugin, options?)`: start the service, returning a promise of the Node HTTP server. Defaults to `PLUGIN_HOST=127.0.0.1` and `PLUGIN_PORT=8789`. Logs connection instructions, never the token.
- `createPluginServer(plugin, options?)`: create the HTTP server without binding, useful for tests or your existing process.
- `validateManifest(value)`, `validateSchema(value)`, `validateValue(schema, value, path?)`: validate locally and throw `PluginValidationError` with a useful explanation.

Runner options include `token`, `concurrency` (1–4, default 4), `timeoutMs` (100–25000, default 25000), and `onError(error)`. `startPlugin` also accepts `host`, `port`, and `log(message)`.

Every action receives `context.actorId`, `context.publicationId`, and `context.signal`. Scope stored state to **both identities**, because separate Margin installations can have the same owner id. Pass the signal to `fetch` and other cancellable operations. It aborts when the client disconnects or the deadline expires.

## Schemas that work in Margin

Input and output roots must have `type: "object"`. Supported schema types are `object`, `array`, `string`, `number`, `integer`, and `boolean`.

Supported constraints are `properties`, `required`, boolean `additionalProperties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, and `maxItems`. `title` and `description` are annotations. Unknown keywords, including `$ref`, `pattern`, and `oneOf`, are rejected rather than silently ignored. Arrays need `items`; required fields must be declared in `properties`.

Schemas are bounded to depth 8 and 256 nodes, 64 properties, and 64 enum values. A plugin has 1–32 actions and up to 32 capabilities. Manifests are capped at 128 KiB.

## What the runner takes care of

Both `GET /manifest` and `POST /actions/{name}` require a bearer token. A token must contain at least 24 non-whitespace characters; the starter generates 32 random bytes. Input is limited to 64 KiB, the full request envelope to 72 KiB, and serialized output to 256 KiB. Handler errors are kept out of HTTP responses; use `onError` for your own private diagnostics.

The concurrency slot remains occupied until a handler actually finishes, including after a timeout response. Timeouts bound waiting; they cannot interrupt synchronous CPU work or a handler that ignores cancellation. The SDK is a service runner, **not a code sandbox**. Use a separately isolated process or container for untrusted code, and apply host resource limits when deploying.

The runner expects Margin's envelope:

```json
{"input":{"text":"Hello Margin"},"context":{"actorId":"1","publicationId":"your-publication-id"}}
```

It returns `{"output":{...}}`. It never receives Margin cookies, API tokens, database credentials, or application internals. See [the protocol guide](../../docs/plugins.md) for other languages and deployment details.

## Use an existing project

```sh
npm install /path/to/Margin/packages/plugin-sdk --ignore-scripts
```

Import from `@margin/plugin-sdk` afterward. This is a local dependency; the path in the generated `package.json` and lockfile must exist on the target machine. For another environment, copy or install the SDK there and update that path. The scaffolder accepts `--sdk /another/local/plugin-sdk` when needed. No public registry package is assumed.

A scaffold name is a lowercase slug, not a destination path. Run the command from your desired parent folder. The tool refuses traversal and existing targets, and never replaces an existing project or `.env` file.
