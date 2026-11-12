# Portable plugin packages

A `.margin-plugin` is a ZIP of browser assets plus `margin-package.json` at its
root. It contains no execution engine, native executable or server launch command.
The package format is `margin.package/v2`:

```json
{
  "packageVersion": "margin.package/v2",
  "plugin": {
    "apiVersion": "margin.plugin/v1",
    "id": "my-widget",
    "name": "My widget",
    "version": "1.0.0",
    "description": "An interactive article component.",
    "capabilities": [],
    "actions": [],
    "blocks": [{
      "id": "widget",
      "title": "My widget",
      "entry": "ui/widget.html",
      "defaultSource": "{}",
      "actions": [],
      "reader": true
    }]
  },
  "files": {
    "ui/widget.html": "<SHA-256 of the exact file bytes>"
  }
}
```

The manifest API version and package format version are separate. `actions: []`
is valid for a component that operates entirely in the browser. An HTTP-backed
component declares its actions as described in [Plugins](plugins.md).

The SDK packer generates the file digests and archive. Bundle the component's JS
and CSS into its HTML entry; frames have no ambient network access. Dependencies
used to build a component belong in its development project, not as a server
runtime inside the package. Keep third-party license notices with distributed
browser code.

## Validation

Margin checks the package version, manifest schemas, block entries, file paths,
size limits and every payload's SHA-256. Traversal, duplicate paths, symlinks,
undeclared files and missing payloads are rejected. `target` and `launch` are not
part of v2. Unsupported formats and unknown manifest fields are rejected.

Directory downloads additionally verify the complete archive's byte size and
SHA-256 against the exact reviewed catalog entry. Installation starts disabled.

## Updates

Keep the plugin ID stable and increase its version. Owners can update through
Browse plugins or upload a replacement in Manage. Updates require `If-Match` with
the installed version, preserve HTTP connection settings and saved content, and
replace files transactionally with recovery after interrupted updates.

Updates apply between current-format browser packages. Margin does not convert
older package formats or run package-supplied migration code.

## Publishing

Publish one portable archive per version to
[WritingMargin/margin-package Releases](https://github.com/WritingMargin/margin-package/releases).
The schema-2 catalog uses a singular `package` object containing `url`, `sha256`
and `size`; there are no OS or CPU variants. Publish new versions rather than
replacing existing release assets. Test installation, upgrade and the actual
browser component before updating the catalog.
