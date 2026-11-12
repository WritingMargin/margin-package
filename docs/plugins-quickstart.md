# Build your first Margin plugin

Build a small text tool, package it with its runtime, and install it in Margin.
The engine starts and stops the plugin for you. The machine running Margin does
not need Node.js, Python, npm, or a separately managed plugin endpoint.

You need Node.js 24 or later **on your development machine**, this Margin
checkout, and a running Margin engine you can sign into as owner.

## Create and package

Want the plugin to supply its own editor and reader UI? Add `--block` to the
create command below, then follow the [custom block guide](plugin-blocks.md).

From the Margin repository root:

```sh
node packages/plugin-sdk/create.mjs create my-margin-plugin
cd my-margin-plugin
npm test
npm run check
npm run pack
```

The last command produces a `.margin-plugin` archive containing your source,
the SDK, and your development machine's Node runtime and distribution license.
The package targets that machine's operating system and architecture. Margin
shows its host target in the install form; build a matching package. See
[packaging for another target](plugin-packages.md#build-for-another-host).

The generator installs the SDK from this checkout without registry access.
`@margin/plugin-sdk` is a local package, not a published npm package. Keep the
checkout available while developing; the finished archive includes the runtime
SDK files and needs no reference to your checkout.

The project name must be a lowercase slug, such as `my-margin-plugin`. To create
it outside the checkout, run the CLI by its absolute path from your preferred
parent directory. The generated `.env` is only for optional local development;
it is excluded from the installable package. Margin creates the installed
plugin's private credential itself.

The generated files have one job each:

| File | What you change |
| --- | --- |
| `plugin.ts` | Plugin identity, capabilities, typed action schemas, and handlers |
| `server.ts` | Service startup |
| `plugin.test.mjs` | Examples and assertions for your action's behavior |
| `.env` | Local service credential and optional listener configuration |
| `package.json` | Development, manifest-check, test, and package commands |

## Try the action in Margin

1. Open **Settings → Integrations → Plugins** as owner.
2. Choose the generated `.margin-plugin` file and install it.
3. Review its capabilities, actions, target and any event subscriptions, then
   enable it. Installation alone does not execute plugin code.
4. Open **Manage → Developer tools**, select **Count my words** (`text.count`),
   enter `Hello Margin` in the **Text** field, and choose **Run action**.

You should receive:

```json
{"words": 2, "characters": 12}
```

This proves the whole path: Margin authenticates the owner, validates the input,
invokes the service, and validates the result. The service token stays on the
engine and is never sent to the reader or browser action handler.

Margin owns the process lifecycle, connection and credential. Disabling the
plugin stops its process; enabling starts it again. You do not configure ports,
copy service tokens, or install a language runtime on the engine host.

## Make it yours

Open `plugin.ts`. Each action defines its input and output schemas alongside the
handler that produces the result. TypeScript infers the handler's types from
those schemas, and the SDK validates requests and results at runtime. Keep the
schemas and handler in sync when changing data shapes.

Try changing the handler to count characters excluding whitespace. Replace its
`characters` value with:

```ts
characters: [...input.text.replace(/\s/g, "")].length
```

Update the action title or description so the owner understands the behavior.
This keeps the output shape intact; a change that adds or removes fields should
also update `outputSchema`. Update the existing test to expect `13` characters
for `Hello, Margin!`, then add a case covering `Hello Margin` and expect `11`.

Run the project checks from its directory:

```sh
npm test
npm run check
```

Tests check your action's behavior. The manifest check catches protocol mistakes
such as unsupported schema keywords or mismatched action definitions. A valid
manifest does not prove your handler is correct, so keep both checks in your
workflow.

The starter uses Node's built-in TypeScript stripping to run without a build
step. Your editor uses the SDK's inferred types; `npm run check` validates the
manifest and is not a TypeScript compiler check. Add your own TypeScript project
configuration and compiler check if you need static type checking in CI.

For a second action, use `defineAction(...)` and add it to the
plugin's `actions` array. Give the action a stable name such as `text.summary`
and the capability a descriptive name such as `text.analysis`. These are your
service's public contract, so avoid renaming them between updates unless you
intend a breaking change. The SDK exports `defineAction`, `definePlugin`, and
`startPlugin`; the generated source is a runnable example of each.

Handlers also receive a context with `actorId`, `publicationId`, and `signal`.
Scope any stored state to both identity fields. Pass `signal` to cancellable
operations such as `fetch` so work can stop when the request ends. The SDK's
deadline limits how long a caller waits; it cannot forcibly stop synchronous CPU
work inside your handler.

## Package changes

Change `version` in `plugin.ts` when the manifest changes, then run tests, the
manifest check and `npm run pack` again. Existing files are never overwritten;
use a new version or `npm run pack -- --output another-name.margin-plugin`.

To update an installed package, open **Manage → Update package** and choose the
new archive. Keep the same plugin ID and use a different version. Margin checks
the package before replacing the installed code, retains its persistent data
directory, and preserves whether it is enabled or disabled. Enabled plugins
restart, so active tasks and in-memory sessions stop during the update.

If the replacement fails its startup checks, Margin restores the previous
package and its data snapshot and tries to restart the previous enabled version.
An interrupted update is recovered before packages start on the next engine
launch. Updates need temporary disk space for the replacement and rollback copy.
Removing a plugin still deletes its data; it is no longer necessary for updates.
Official releases are also available through **Browse plugins**, backed by the
[WritingMargin package directory](https://github.com/WritingMargin/margin-package).
Directory updates use the same data-preserving flow and require owner review;
there is no automatic background installation. Private packages can still be
uploaded directly. See the [update contract](plugin-packages.md#update-an-installed-package).

## Optional local development loop

```sh
npm run dev
```

This watches source files and restarts the development service when they change.
For action-only plugins, to test directly through Margin while editing, use the advanced service
connection with the printed address and `PLUGIN_TOKEN` from `.env`. Keep that
file private. This is optional; installed packages need neither a manually
configured endpoint nor your development token. Localhost refers to the engine's
own host or container, so a development endpoint must be reachable from there.
Plugins that declare blocks must be packaged; their UI is loaded from verified
package assets, not from an external development service.

## Use another language

The SDK is optional. A compatible executable can be written in Python, Go,
Rust, or another language. Package the executable and everything it needs to
run using the [prebuilt payload mode](plugin-packages.md#package-another-runtime).
The engine launches the declared executable and communicates over the same
[language-neutral protocol](plugins.md#service-protocol-marginpluginv1).

The [Python notebook reference](../examples/plugins/python-notebook/README.md#build-an-installable-notebook-package)
includes a builder that bundles a standalone interpreter and Jupyter dependencies.
Its macOS arm64 package is verified through real engine installation and kernel
execution with an empty host PATH. Build and test on each target platform; the
service and container developer loop remains available.

## When something goes wrong

| Symptom | Check |
| --- | --- |
| Package target is rejected | Build for the operating system and architecture shown by Margin. |
| Installed plugin will not start | Check its runtime status; verify the package includes its runtime and dependencies for that host. |
| Packaging cannot locate the Node license | Keep the official distribution LICENSE beside its runtime or provide `--runtime-license`. |
| An action has old fields | Install the new package version; external development connections require manifest refresh. |
| Input validation fails | Match the action's schema; runtime validation does not coerce strings into numbers. |
| Local tests pass but the HTTP result is rejected | Compare the returned object with `outputSchema`; the engine validates output too. |

For protocol limits, error handling, schema keywords, and owner-only API routes,
continue with the [plugin reference](plugins.md).
