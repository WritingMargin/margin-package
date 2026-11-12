import { validateManifest, validateSchema, validateValue, PluginValidationError } from "./schema.mjs";
export { validateManifest, validateSchema, validateValue, PluginValidationError };
export { createPluginServer, startPlugin } from "./server.mjs";
const plugins = new WeakMap();
export function defineAction(definition) {
  if (typeof definition?.handler !== "function" && !definition?.http) throw new PluginValidationError("Action needs a handler(input, context) function.");
  return Object.freeze({ ...definition });
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function definePlugin(definition) {
  const { actions, ...metadata } = definition;
  if (!Array.isArray(actions)) throw new PluginValidationError("Plugin needs an actions array.");
  const manifest = structuredClone({ apiVersion: "margin.plugin/v1", ...metadata, actions: actions.map(({ handler: _handler, ...action }) => action) });
  validateManifest(manifest);
  const handlers = new Map(actions.map((action) => {
    if (action.handler !== undefined && typeof action.handler !== "function") throw new PluginValidationError(`Invalid handler for ${action.name}.`);
    return [action.name, action.handler];
  }));
  const plugin = Object.freeze({ manifest: freeze(manifest) });
  plugins.set(plugin, handlers);
  return plugin;
}
export function pluginHandler(plugin, name) {
  const handlers = plugins.get(plugin);
  if (!handlers) throw new PluginValidationError("Create your plugin with definePlugin().");
  return handlers.get(name);
}
