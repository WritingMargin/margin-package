import { validateManifest, validateSchema, validateValue, validateAction, PluginValidationError } from './schema.mjs';
export { validateManifest, validateSchema, validateValue, PluginValidationError };
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Define an HTTP action contract. Implement its endpoint in your own service. */
export function defineAction(definition) {
  validateAction(definition);
  return freeze(structuredClone(definition));
}
/** A plugin is declarative metadata and bundled browser assets, never handlers. */
export function definePlugin(definition) {
  const manifest = { apiVersion: 'margin.plugin/v1', ...definition };
  validateManifest(manifest);
  return Object.freeze({ manifest: freeze(structuredClone(manifest)) });
}
