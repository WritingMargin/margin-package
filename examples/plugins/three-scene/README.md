# Three.js scenes plugin

Create, save and explore Three.js scenes through a block supplied entirely by
this plugin. Its package contains the editor, controls, validated scene renderer,
execution worker and Node runtime. Margin provides a generic plugin frame and
action bridge; this block needs no Three.js-specific core component or scene validator.

The plugin uses real Three.js **0.186.1** and esbuild **0.28.2**. Its package build
is verified on **macOS arm64**; build and test on the matching platform before
distributing another target. The engine host needs no Node/npm installation or
separately configured endpoint.

## Build and install

With Node.js 24 or later on the developer machine, from the repository root:

```sh
cd examples/plugins/three-scene
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run pack -- /tmp/margin-three-block.margin-plugin
```

The build bundles the server, worker and browser UI, inlines the UI JavaScript
and CSS into `ui/scene.html`, copies the current Node runtime, includes the Node
and Three.js licenses, and creates a hashed archive. The UI loads no external
scripts, styles, fonts or assets. Keep the official Node distribution LICENSE
beside its binary. The package targets the developer host's OS and architecture;
the install form shows Margin's required target. Existing output files are never
overwritten.

Install the file in **Settings → Integrations → Plugins**, review its
`scene.execute` action and **Three.js scene** block, then enable it. In the article
editor choose **Plugin block → Three.js scene**. The plugin opens its own code
editor with a working example:

1. Edit the code or keep the example, then choose **Run scene**.
2. Drag to orbit, scroll to zoom, choose **Play animation**, or use **Reset view**.
3. Choose **Save scene** to include the generated result in this block.
4. Choose the host's **Insert block** or **Apply changes**, then save the article
   through its usual workflow.

Edits remain staged until you insert/apply the block; Cancel leaves the article
unchanged. Editing code drops the old saved snapshot so it cannot silently show
an outdated result. Run and save again to replace it.

## Editor, preview and reader behavior

The manifest declares block ID `scene`, entry `ui/scene.html`, the scoped action
`scene.execute`, and `reader: true`. Its Markdown fence is
`plugin:three-scene:scene`; the fence source is JSON containing `{code, scene?}`.
The `scene` value is a validated execution result, written by **Save scene**.

- **Edit:** the plugin owns its code editor, Run/Stop, renderer and explicit Save
  scene control. It stages source changes through the generic SDK bridge.
- **Author preview:** Run displays a temporary result; it never changes the
  article or stored snapshot. Saved results are displayed initially.
- **Read:** only the stored scene renders. Readers can orbit, zoom, reset and play
  saved animation clips, but there are no execution controls or action calls.
  Without a saved result, the block explains that no scene was saved.

Animations start paused. Author JavaScript is executed only by the installed
service's worker, never evaluated by the browser renderer. Legacy `threejs` code
fences are ordinary source blocks; use **Plugin block** for the plugin-owned UI.

## Author code API

Write synchronous JavaScript statements. These objects already exist:

| Name | Purpose |
| --- | --- |
| `THREE` | The actual Three.js module namespace |
| `scene` | Empty `THREE.Scene`; add meshes and lights here |
| `camera` | Perspective camera; set `camera.position` and `camera.fov` |
| `target` | `THREE.Vector3` that the preview camera looks toward |
| `animations` | Array for `THREE.AnimationClip` instances |
| `console` | Captured `log`, `info`, `warn`, and `error` output |

For example:

```js
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x6ee7b7 })
);
cube.name = "cube";
scene.add(cube);
scene.add(new THREE.AmbientLight(0xffffff, 2));
camera.position.set(3, 2, 4);
target.set(0, 0, 0);
animations.push(new THREE.AnimationClip("Spin", 4, [
  new THREE.NumberKeyframeTrack("cube.rotation[y]", [0, 4], [0, Math.PI * 2])
]));
console.log("Built a cube with Three.js", THREE.REVISION);
```

Use the provided `target` to aim the camera; only position, target and field of
view are returned. Do not create a renderer, canvas, controls, render loop or
`requestAnimationFrame`. There is no DOM, `window`, `document`, `fetch`, package
import, or top-level `await` API in author code. Margin owns rendering and
controls. For movement, return keyframe clips rather than executable callbacks.

## Supported scenes and bounds

Ordinary generated geometries such as BoxGeometry, SphereGeometry and
TorusKnotGeometry work: the plugin converts them to plain BufferGeometry before
serialization. The plugin-local validator runs before returning the scene and again before
the plugin UI loads a saved or newly returned result.

- At most 128 objects, 64 geometries, 64 materials and 8,000 total vertices.
- Meshes, groups, lines, line segments, points and common lights are supported.
- Standard/physical/phong/lambert/basic/normal/depth mesh materials, LineBasicMaterial
  and PointsMaterial are supported. Solid-color scene backgrounds are supported.
- No textures, external assets, images, custom shaders, clipping planes,
  skeletons or morph targets.
- Up to eight animation clips, 32 tracks each and 600 keys per track, with key
  times from 0 to 120 seconds. Tracks may target a named object's position,
  quaternion, scale, or rotation axis.
- Camera field of view is 10–100 degrees. Camera position and target must differ.
- At most 40 log entries of 500 characters each, and 220 KiB of returned JSON.
- Code is limited to 48,000 characters, subject to the engine's smaller effective
  JSON request limit when escaping or non-ASCII characters increase its size.

Synchronous code has a two-second VM timeout. A five-second worker deadline also
covers scene normalization and serialization; cancellation terminates the
worker. The service permits two concurrent jobs. Each worker gets a configured
128 MiB V8 heap budget and is removed when the job finishes. This is **not** a
total-process memory cap: native allocations and typed-array buffers can exceed
the V8 heap budget.

This plugin executes **trusted owner code only**. Neither `node:vm` nor worker
threads are a security sandbox for hostile authors. The worker receives an empty
environment to avoid accidental service-token inheritance, but installed code
still runs with the service user's OS privileges. Use an independently isolated
execution platform before accepting code from public readers or unrelated users.

## Action contract

Capability and action name are both `scene.execute`. Input:

```json
{"code": "scene.add(new THREE.AmbientLight(0xffffff, 2));"}
```

A successful output has `ok: true`, `scene`, `camera`, `animations`, and `logs`.
A syntax error, author exception, unsupported scene, or execution limit returns
`{"ok":false,"logs":[],"error":"..."}`. It does not turn an ordinary code error
into a generic HTTP failure. Each run starts with a fresh scene and worker.

## Verify the package

From the repository root after building the archive:

```sh
# Place a plugin-capable Margin server at artifacts/margin-server.
node tests/three-package-smoke.mjs /tmp/margin-three-block.margin-plugin
```

Unit tests exercise source staging and reader/preview write restrictions, then
execute real Three.js code and verify round-tripped geometry/materials,
lights, camera and clips; syntax/runtime errors; unsupported resources; bounded
logs; loop and serialization deadlines; cancellation; worker cleanup; and
recovery on the next run. The engine smoke test installs the archive with an
empty host PATH, exercises actual actions and lifecycle controls, and verifies
authorization and restart behavior.
