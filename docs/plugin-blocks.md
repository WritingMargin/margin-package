# Plugin editor and reader blocks

Portable plugins supply their whole interface. Margin discovers block descriptors
from the package manifest and places enabled blocks in the **Plugin block** menu.
There is no custom renderer to register in Margin's core.

Each descriptor identifies an HTML entry, a title, optional initial source, a list of allowed actions, and whether it has a reader view.
Article fences use `plugin:<plugin-id>:<block-id>`; language aliases are not supported.
The same component receives an `edit`, `preview` or `read` context.

```js
import { connectBlock } from '@margin/plugin-sdk/browser';

const client = await connectBlock();
const source = JSON.parse(client.context.source || '{}');

// Save article source from the editor only.
if (client.context.mode === 'edit') {
  client.change(JSON.stringify({ ...source, label: 'Try it' }));
}

// A user gesture can invoke a declared action through Margin's HTTP bridge.
// Show the control only when the host grants this action in this context.
if (client.context.actions.includes('estimate')) {
  const result = await client.action('estimate', { quantity: 3 });
  // Render result as text or through your component framework, not unsafe HTML.
}
```

Use an actual click handler for remote calls rather than running them as the
component mounts. This keeps reader interactions intentional and avoids repeated
calls as articles render. Action names must appear in the block's allowlist;
reader actions also require the owner to enable public calls for that connection.

## Host capabilities

- `client.context`: mode, source, theme and granted action names; no secrets.
- `client.change(source)`: update the block's source in edit mode only.
- `client.action(name, input, {signal})`: invoke a granted HTTP action.
- `client.resize(height)`: request a bounded frame height.
- `client.importTextFile(...)`: ask the editor to select a text file; edit only.
- `client.download(name, mime, text)`: offer a file download through the host UI.
- `client.setCleanup(action, input)`: register owner-mode cleanup for an external
  session; readers cannot register cleanup actions.
- `client.close()`: cancel outstanding requests and close the message channel.

The parent verifies the sending frame and grants a dedicated MessagePort. The
host validates every action and keeps pending calls and response sizes bounded.
Frames are sandboxed without `allow-same-origin`, so component code cannot access
publication cookies or the parent DOM. Direct network requests are blocked; use
the HTTP bridge when network access is required.

Browser worker execution, such as Three.js code evaluation, stays inside the
browser sandbox. An execution timeout can terminate a worker without starting
any server process. Margin's own Go process never evaluates plugin JavaScript.

## Persistence and unavailable plugins

Persist portable JSON or other text using `change`; that text lives with the
article and survives plugin updates or removal. Keep saved outputs suitable for
reader views. API keys, remote session credentials and secrets must never appear
in article source. When a block is unavailable, Margin preserves and displays its
saved source instead of deleting content.

A remote notebook session belongs to its external service. The service should
expire abandoned sessions and enforce its own quotas even if the browser closes
before cleanup can arrive. Margin does not manage that server's Python processes.
