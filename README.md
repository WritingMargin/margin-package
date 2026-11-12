# Margin packages

The official plugin directory for [Margin](https://github.com/WritingMargin/margin).
Plugins add optional tools and editor blocks without changing Margin's core.

## Install in Margin

In a Margin engine with plugin support, open **Settings → Integrations → Plugins →
Browse plugins**. Choose a plugin, review its publisher and capabilities, and
install it. Margin selects a package for the **server's** operating system and
architecture, verifies its checksum, and installs it disabled. Enable it to start
using its blocks in the editor's **Plugin block** menu.

You can also download a `.margin-plugin` from this repository's Releases and use
**Upload plugin**. Installing and managing plugins requires the publication owner.
Plugins run as trusted server code; they are not a sandbox for untrusted authors.

| Plugin | What it adds |
| --- | --- |
| [Jupyter notebook](examples/plugins/python-notebook/) | Notebook import/export, editable cells, Python execution, and saved outputs for readers. Includes Python and Jupyter dependencies. |
| [Three.js scenes](examples/plugins/three-scene/) | A scene editor, Three.js execution, and interactive 3D views. Includes Node.js and Three.js. |

Only platforms with a verified release appear as installable. Unsupported engines
still show the plugin with an explanation. These plugins require Margin's optional
plugin implementation; they do not work in earlier releases without plugin support.

## How the directory works

[`catalog.json`](catalog.json) contains the reviewed listing and exact release
assets for each platform. The large runtime archives are attached to **GitHub
Releases**, not committed to Git. Margin downloads the selected archive on its
server and checks its size, SHA-256, package identity, version, and target before
installation. A public directory does not require users to have a GitHub account.

Each plugin has its own release tag, such as `python-notebook-v0.3.0`. Published
assets must not be replaced. Publish a new plugin version when code or packaged
dependencies change. Update installations through Margin to retain the managed
data directory and enabled state; active runtime sessions restart.

## Build and publish

This repository includes the plugin source and a local copy of the Margin SDK.
Node.js 24 or later is needed to build. The notebook package also needs a
relocatable Python distribution; see its README for exact build instructions.
Build on each target platform and test the resulting package through a Margin
engine before adding that platform to the catalog.

```sh
npm ci --prefix examples/plugins/three-scene
node examples/plugins/three-scene/build.mjs /tmp/three-scene.margin-plugin

npm ci --prefix examples/plugins/python-notebook
# Follow the notebook README to select standalone Python and build the archive.
```

For a release:

1. Build and test the platform archives, including a real engine install and execution.
2. Create the plugin's versioned GitHub Release and attach its `.margin-plugin` files.
3. Add each asset's exact URL, byte size, and SHA-256 to `catalog.json`.
4. Run `node scripts/validate-catalog.mjs --verify-assets`.
5. Review and merge the catalog change. Margin can then discover the release.

Catalog changes and source changes are reviewed through pull requests. The initial
directory contains official WritingMargin packages only. The catalog is a trusted
distribution list, not permission for a package to run before the owner enables it.
Bundled runtime and dependency licenses are retained in each package.
