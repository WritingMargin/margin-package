import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ThreeExecution } from "../lib/three-plugin.ts";

export function createThreeScene(
  host: HTMLElement,
  result: ThreeExecution,
  onError: (message: string) => void,
) {
  const scene = loadScene(result);
  let runtime: ThreeSceneRuntime | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    runtime = new ThreeSceneRuntime(host, scene, renderer, result, onError);
    runtime.start();
    return runtime;
  } catch (error) {
    if (runtime) runtime.dispose();
    else {
      renderer?.dispose();
      renderer?.forceContextLoss();
      disposeScene(scene);
    }
    throw error;
  }
}
function loadScene(result: ThreeExecution): THREE.Scene {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => {
    throw new Error("Scene preview does not load external resources.");
  });
  const object = new THREE.ObjectLoader(manager).parse(result.scene);
  if (object instanceof THREE.Scene) return object;
  const scene = new THREE.Scene();
  scene.add(object);
  return scene;
}
export class ThreeSceneRuntime {
  private camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  private controls: OrbitControls;
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[] = [];
  private observer?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private visible = true;
  private playing = false;
  private disposed = false;
  private lastFrame = 0;
  private resetPosition = new THREE.Vector3();
  private resetTarget = new THREE.Vector3();
  private boundsRadius = 1;
  constructor(
    private host: HTMLElement,
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private result: ThreeExecution,
    private onError: (message: string) => void,
  ) {
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.mixer = new THREE.AnimationMixer(scene);
  }
  start() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Three.js scene. Drag to orbit, scroll to zoom, arrow keys to pan, plus and minus to zoom.",
    );
    this.host.appendChild(this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.addEventListener("change", this.render);
    this.renderer.domElement.addEventListener("keydown", this.keyboard);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    document.addEventListener("visibilitychange", this.syncLoop);
    this.configureScene();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.visibility = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.syncLoop();
    });
    this.visibility.observe(this.host);
    this.resize();
    this.reset();
  }
  private configureScene() {
    if (!this.scene.background)
      this.scene.background = new THREE.Color("#f6f8f2");
    const bounds = new THREE.Box3().setFromObject(this.scene);
    const target = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3());
    this.boundsRadius = Math.max(
      bounds.getSize(new THREE.Vector3()).length() / 2,
      0.5,
    );
    this.resetTarget.copy(target);
    this.resetPosition
      .copy(target)
      .add(
        new THREE.Vector3(1, 0.7, 1)
          .normalize()
          .multiplyScalar(this.boundsRadius * 3.5),
      );
    this.applyCamera();
    this.camera.near = Math.max(this.boundsRadius / 1000, 0.001);
    this.camera.far = Math.max(
      this.boundsRadius * 100,
      this.resetPosition.distanceTo(this.resetTarget) * 10,
      100,
    );
    this.controls.minDistance = this.boundsRadius / 100;
    this.controls.maxDistance = Math.max(
      this.boundsRadius * 50,
      this.resetPosition.distanceTo(this.resetTarget) * 5,
    );
    this.clips = (this.result.animations || []).map((clip) =>
      THREE.AnimationClip.parse(clip as unknown as THREE.AnimationClipJSON),
    );
  }
  private applyCamera() {
    if (!this.result.camera) return;
    this.resetPosition.fromArray(this.result.camera.position);
    this.resetTarget.fromArray(this.result.camera.target);
    this.camera.fov = this.result.camera.fov;
  }
  private resize() {
    if (this.disposed) return;
    const width = Math.max(this.host.clientWidth, 1),
      height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  reset = () => {
    this.camera.position.copy(this.resetPosition);
    this.controls.target.copy(this.resetTarget);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  };
  private render = () => {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  };
  private frame = (time: number) => {
    const delta = this.lastFrame
      ? Math.min((time - this.lastFrame) / 1000, 0.1)
      : 0;
    this.lastFrame = time;
    this.mixer.update(delta);
    this.render();
  };
  private syncLoop = () => {
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(
      this.playing && this.visible && !document.hidden ? this.frame : null,
    );
  };
  selectClip(index: number) {
    this.mixer.stopAllAction();
    const clip = this.clips[index];
    if (clip) this.mixer.clipAction(clip).reset().play();
    this.mixer.update(0);
    this.render();
  }
  play(value: boolean) {
    this.playing = value;
    this.syncLoop();
  }
  private keyboard = (event: KeyboardEvent) => {
    if (!["+", "=", "-"].includes(event.key)) return;
    event.preventDefault();
    const distance = this.camera.position
      .clone()
      .sub(this.controls.target)
      .multiplyScalar(event.key === "-" ? 1.15 : 1 / 1.15);
    distance.clampLength(this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(distance);
    this.controls.update();
    this.render();
  };
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.onError(
      "The 3D preview lost its graphics connection. Run the scene again to reopen it.",
    );
    this.dispose();
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    this.visibility?.disconnect();
    document.removeEventListener("visibilitychange", this.syncLoop);
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.renderer.domElement.removeEventListener("keydown", this.keyboard);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    disposeScene(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ))
      return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
