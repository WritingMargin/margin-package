# Three.js browser plugin

Three.js runs entirely in the visitor's browser. This portable v2 package contains its editor, renderer, a bundled disposable WebWorker and the Three.js license. It has no HTTP actions, Node runtime, server process or platform-specific executable.

```sh
npm ci --prefix examples/plugins/three-scene
npm test --prefix examples/plugins/three-scene
node examples/plugins/three-scene/build.mjs /tmp/three-scene-0.3.0.margin-plugin
```

Install and enable the archive, then insert **Three.js scene**. Edit code, choose **Run scene**, explore the result and choose **Save scene**, then Margin's Insert/Apply. Code and the validated snapshot are saved in the block. Author preview runs are temporary; readers explore the saved scene without executing author code.

The code receives `THREE`, `scene`, `camera`, `target`, `animations` and a bounded `console`. See `example.threejs`. It cannot use the DOM, WebGLRenderer or requestAnimationFrame; add transform keyframe clips to `animations` instead. The viewer provides orbit, reset and animation controls.

A two-second parent deadline terminates each worker, including infinite loops and serialization loops. Stop, source edits and leaving the frame terminate active work. This provides browser isolation and cancellation, not a hard browser memory limit. Network APIs are disabled and the opaque iframe CSP blocks connections. Standard materials and bounded geometry/animation are validated before rendering; textures, custom shaders and external assets are unsupported.

`runner.test.mjs` uses a Node worker only as a test adapter for the exact browser worker bundle. Node is never shipped. The generic engine lifecycle check is `npm run test:plugin-browser`; live iframe/WebGL verification requires a browser.
