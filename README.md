# Margin packages

The official browser-plugin directory for [Margin](https://github.com/WritingMargin/margin).
Plugins bring editor blocks and interactive article components to Margin without
adding a server execution engine.

## Install in Margin

Open **Settings → Integrations → Plugins → Browse plugins**. Choose a plugin,
review it, install and enable it. Its blocks appear in the editor's **Plugin block**
menu. You can also download a `.margin-plugin` from Releases and choose
**Upload plugin**. Installation and configuration require the publication owner.

Each plugin has one portable browser package. There are no Node.js or Python
executables, runtime downloads or operating-system-specific builds.

| Plugin | What it adds |
| --- | --- |
| [Jupyter notebook](examples/plugins/python-notebook/) | Browser notebook editor, import/export and saved reader outputs. Python execution uses your independently hosted HTTP service. |
| [Three.js scenes](examples/plugins/three-scene/) | Browser code editor, worker-based scene generation and interactive 3D views. No server runtime. |

For an article component that needs your server, configure its public HTTPS base
URL and optional API key in Margin. Margin's built-in Go HTTP bridge validates
requests and attaches the encrypted credential server-side. Reader-facing actions
are disabled until the owner explicitly allows them. API keys are never supplied
to browser components.

## Directory and updates

[`catalog.json`](catalog.json) uses schema version 2. Each listing has a singular
`package` with its exact release URL, byte size and SHA-256. Margin verifies the
archive and its manifest before installation. Public browsing and downloads need
no GitHub account.

Keep the plugin ID stable and increase its version. Updates preserve saved article
source and HTTP connection settings. Publish a new release rather than replacing
an existing asset. Only the current portable package and browser SDK contract is
supported. There are no native runtime, external plugin-wire or language-alias
compatibility paths.

## Develop a plugin

This repository includes the browser SDK and source for the official plugins.
Node.js is a development/build tool only; Margin does not need Node to host them.
Start with the [quickstart](docs/plugins-quickstart.md), then read the
[block SDK](docs/plugin-blocks.md), [HTTP bridge](docs/plugins.md) and
[package format](docs/plugin-packages.md).

A browser-only component needs no backend. Components that need computation can
call your HTTP service in whatever language you prefer. Any optional example
Python service is deployed independently; it is never installed by Margin.

## Publish

1. Build a portable `.margin-plugin` and test its actual editor and reader views.
2. Test install, enable, update, and declared HTTP interactions in Margin.
3. Attach the archive to a versioned release such as `three-scene-v0.4.0`.
4. Update the reviewed catalog with the exact archive URL, size and SHA-256.
5. Run `node scripts/validate-catalog.mjs --verify-assets`.

The directory initially contains official WritingMargin packages. Retain license
notices for browser libraries distributed in each package. Do not include secrets,
server binaries, development environments or `node_modules` directories.
