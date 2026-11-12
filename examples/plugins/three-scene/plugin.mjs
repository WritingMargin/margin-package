import { definePlugin } from "@margin/plugin-sdk";
import { defaultSource } from "./default-source.mjs";
export default definePlugin({
  id:"three-scene", name:"Three.js scenes", version:"0.4.0",
  description:"Build interactive 3D scenes and animations entirely in your browser.",
  capabilities:[], actions:[],
  blocks:[{id:"scene",title:"Three.js scene",description:"Run code locally, save a scene, and let readers explore it.",entry:"ui/scene.html",defaultSource,actions:[],reader:true}],
});
