# Margin browser plugin SDK

Build a small, portable `.margin-plugin` archive containing a manifest and bundled browser UI. Margin never launches an installed plugin as a server process. Node is a developer build tool only.

From the Margin checkout:

```sh
node packages/plugin-sdk/create.mjs create my-plugin
cd my-plugin
npm test
npm run check
npm run pack
```

Install the resulting archive in Margin's plugin settings. The default writing card counts words locally; it needs no endpoint or API key. Edit `dist/block.html` and `manifest.json`, test, then package again. The SDK is a local dependency and is not published to npm.

For an existing bundled UI:

```sh
node packages/plugin-sdk/pack.mjs --directory dist --manifest manifest.json --output my-plugin.margin-plugin
```

The ZIP contains exactly `margin-package.json` metadata (`packageVersion: "margin.package/v2"`, `plugin`, `files`) and hashed regular browser assets. No `target`, `launch`, runtime binary, server code, credential or dependency directory is packaged. Symlinks, unsafe paths and common secret files are rejected. Each block entry is self-contained HTML with inline JS/CSS; bundle your framework and libraries before packing.

`connectBlock()` provides source, theme, edit/preview/read mode and scoped messaging. Only edit mode can call `change(source)`. The author commits staged changes with Insert/Apply. Import/export go through explicit host controls. Worker code may run in an isolated browser worker; it has no server access, and the iframe's network access is blocked.

For server work, declare an action with JSON input/output schemas and `http: {method: "POST", path: "/fixed/path", reader: false}`. GET accepts an empty input object. The owner supplies a public HTTPS base URL and optional credentials in Margin settings. The bridge sends raw JSON input and validates the raw JSON object response. It never accepts a URL or credential from the iframe. Public actions need `reader: true`, block inclusion and owner reader opt-in; the effective allowlist arrives as `context.actions` / `context.readerActions`.

See `examples/plugins/http-playground` for a reader API block, `three-scene` for local worker execution, and `python-notebook` for a separately deployed notebook service. Jupyter's service authenticates the bridge and uses server-derived `X-Margin-Actor-Id` / `X-Margin-Publication-Id` headers to scope sessions.

The optional `defineAction` handler and `startPlugin` utilities remain for independently hosted service examples and tests. They are never installed or launched by a browser package. New services can use any language or framework and only need the declared HTTP contract.
