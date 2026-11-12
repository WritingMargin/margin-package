export class PluginValidationError extends Error {
  constructor(message) { super(message); this.name = "PluginValidationError"; }
}
const reject = (message) => { throw new PluginValidationError(message); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const actionName = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const allowed = {
  object: ["properties", "required", "additionalProperties"],
  array: ["items", "minItems", "maxItems"],
  string: ["minLength", "maxLength"],
  integer: ["minimum", "maximum"],
  number: ["minimum", "maximum"],
  boolean: [],
};
function keys(value, known, path) {
  if (!object(value)) reject(`${path}: expected an object.`);
  for (const key of Object.keys(value)) if (!known.includes(key)) reject(`${path}: unsupported field '${key}'.`);
}
function text(value, min, max, path) {
  if (typeof value !== "string" || Buffer.byteLength(value) < min || Buffer.byteLength(value) > max) reject(`${path}: expected ${min}–${max} UTF-8 bytes.`);
}
function bounds(schema, low, high) {
  for (const key of [low, high]) {
    if (!(key in schema)) continue;
    const value = schema[key];
    if (typeof value !== "number" || !Number.isFinite(value)) reject(`${key}: expected a finite number.`);
    if (low !== "minimum" && (!Number.isInteger(value) || value < 0)) reject(`${key}: expected a nonnegative integer.`);
  }
  if (low in schema && high in schema && schema[low] > schema[high]) reject(`${low} cannot exceed ${high}.`);
}
function schemaProperties(schema, depth, budget) {
  if ("additionalProperties" in schema && typeof schema.additionalProperties !== "boolean") reject("additionalProperties must be true or false.");
  const properties = "properties" in schema ? schema.properties : {};
  if (!object(properties) || Object.keys(properties).length > 64) reject("properties must contain at most 64 schemas.");
  for (const child of Object.values(properties)) schemaDefinition(child, depth + 1, budget);
  const required = "required" in schema ? schema.required : [];
  if (!Array.isArray(required) || required.length > 64) reject("required must be an array with at most 64 entries.");
  const seen = new Set();
  for (const key of required) {
    if (typeof key !== "string" || !Object.hasOwn(properties, key) || seen.has(key)) reject("required must name unique declared properties.");
    seen.add(key);
  }
}
function schemaDefinition(schema, depth, budget) {
  if (depth > 8 || --budget.remaining < 0) reject("Schema is too complex (maximum depth 8 and 256 nodes).");
  if (!object(schema) || !Object.hasOwn(allowed, schema.type)) reject("Schema needs a supported type.");
  keys(schema, ["type", "title", "description", "enum", ...allowed[schema.type]], "schema");
  for (const key of ["title", "description"]) if (key in schema) text(schema[key], 0, 2000, key);
  if ("enum" in schema && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 64)) reject("enum must contain 1–64 values.");
  for (const pair of [["minimum", "maximum"], ["minLength", "maxLength"], ["minItems", "maxItems"]]) bounds(schema, ...pair);
  if (schema.type === "array") schemaDefinition(schema.items, depth + 1, budget);
  if (schema.type === "object") schemaProperties(schema, depth, budget);
}
export function validateSchema(schema) {
  schemaDefinition(schema, 0, { remaining: 256 });
  return schema;
}
function range(schema, value, low, high, path) {
  if (low in schema && value < schema[low]) reject(`${path}: below ${low} (${schema[low]}).`);
  if (high in schema && value > schema[high]) reject(`${path}: above ${high} (${schema[high]}).`);
}
function sameJSON(a, b) {
  if (a === b) return true;
  if (!object(a) || !object(b)) return sameArray(a, b);
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((key) => Object.hasOwn(b, key) && sameJSON(a[key], b[key]));
}
function sameArray(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJSON(value, b[i])); }
function objectValue(schema, value, path) {
  if (!object(value)) reject(`${path}: expected an object.`);
  for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) reject(`${path}.${key}: required.`);
  const properties = "properties" in schema ? schema.properties : {};
  for (const [key, child] of Object.entries(value)) {
    if (Object.hasOwn(properties, key)) validateValue(properties[key], child, `${path}.${key}`);
    else if (schema.additionalProperties === false) reject(`${path}.${key}: unknown property.`);
  }
}
function arrayValue(schema, value, path) {
  if (!Array.isArray(value)) reject(`${path}: expected an array.`);
  range(schema, value.length, "minItems", "maxItems", path);
  value.forEach((child, index) => validateValue(schema.items, child, `${path}[${index}]`));
}
function numberValue(schema, value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) reject(`${path}: expected a finite number.`);
  if (schema.type === "integer" && !Number.isInteger(value)) reject(`${path}: expected an integer.`);
  range(schema, value, "minimum", "maximum", path);
}
export function validateValue(schema, value, path = "input") {
  if (schema.enum && !schema.enum.some((choice) => sameJSON(choice, value))) reject(`${path}: value is not in enum.`);
  switch (schema.type) {
    case "object": objectValue(schema, value, path); break;
    case "array": arrayValue(schema, value, path); break;
    case "string":
      if (typeof value !== "string") reject(`${path}: expected a string.`);
      range(schema, [...value].length, "minLength", "maxLength", path); break;
    case "number": case "integer": numberValue(schema, value, path); break;
    case "boolean": if (typeof value !== "boolean") reject(`${path}: expected a boolean.`); break;
    default: reject(`${path}: unsupported schema type.`);
  }
  return value;
}
export function validateAction(action) {
  keys(action, ["name", "title", "description", "inputSchema", "outputSchema", "http"], "action");
  text(action.name, 1, 80, "action.name");
  if (!actionName.test(action.name)) reject("Action names use lowercase letters, numbers, dots or hyphens.");
  text(action.title, 1, 120, "action.title");
  if (action.description !== undefined) text(action.description, 0, 2000, "action.description");
  validateHTTP(action.http);
  for (const schema of [action.inputSchema, action.outputSchema]) {
    if (schema?.type !== "object") reject("Action inputSchema and outputSchema must have type object.");
    validateSchema(schema);
  }
}
export function validateManifest(manifest) {
  keys(manifest, ["apiVersion", "id", "name", "version", "description", "capabilities", "actions", "hooks", "blocks"], "manifest");
  if (manifest.apiVersion !== "margin.plugin/v1") reject("Use apiVersion 'margin.plugin/v1'.");
  text(manifest.id, 1, 64, "id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) reject("Plugin id must be a lowercase slug.");
  text(manifest.name, 1, 120, "name"); text(manifest.version, 1, 120, "version"); text(manifest.description, 0, 2000, "description");
  validateCapabilities(manifest.capabilities);
  if (!Array.isArray(manifest.actions) || manifest.actions.length > 32) reject("Provide 0–32 actions.");
  const names = new Set();
  for (const action of manifest.actions) {
    validateAction(action);
    if (names.has(action.name)) reject(`Duplicate action '${action.name}'.`);
    names.add(action.name);
  }
  validateHooks(manifest.hooks, names);
  validateBlocks(manifest.blocks, names);
  if (Buffer.byteLength(JSON.stringify(manifest)) > 128 * 1024) reject("Manifest exceeds 128 KiB.");
  return manifest;
}
function validateBlocks(blocks, actions) {
  if (blocks === undefined) return;
  if (!Array.isArray(blocks) || blocks.length > 16) reject("Provide at most 16 editor blocks.");
  const ids = new Set();
  for (const block of blocks) {
    validateBlock(block, actions);
    if (ids.has(block.id)) reject("Duplicate block id.");
    ids.add(block.id);
  }
}
function validateBlock(block, actions) {
  keys(block, ["id", "title", "description", "entry", "defaultSource", "actions", "reader"], "block");
  text(block.id, 1, 64, "block.id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(block.id)) reject("Block id must be a lowercase slug.");
  text(block.title, 1, 120, "block.title");
  if (block.description !== undefined) text(block.description, 0, 1000, "block.description");
  validateBlockEntry(block.entry);
  if (block.defaultSource !== undefined && (typeof block.defaultSource !== "string" || [...block.defaultSource].length > 48000)) reject("Block defaultSource must contain at most 48000 characters.");
  if (block.reader !== undefined && typeof block.reader !== "boolean") reject("Block reader must be a boolean.");
  validateBlockActions(block.actions, actions);
}
function validateBlockEntry(entry) {
  text(entry, 1, 1024, "block.entry");
  if (!entry.endsWith(".html") || /[\\:\x00-\x1f]/.test(entry) || entry.startsWith("/") || entry.split("/").some(part => !part || part === "." || part === "..")) reject("Block entry must be a safe packaged .html path.");
}
function validateBlockActions(names, actions) {
  if (!Array.isArray(names) || names.length > 32) reject("Block actions must be an array of at most 32 declared actions.");
  const seen = new Set();
  for (const name of names) {
    if (!actions.has(name) || seen.has(name)) reject("Block actions must reference unique declared actions.");
    seen.add(name);
  }
}
function validateHooks(hooks, actions) {
  if (hooks === undefined) return;
  if (!Array.isArray(hooks) || hooks.length > 16) reject("Provide at most 16 hooks.");
  const seen = new Set();
  for (const hook of hooks) {
    keys(hook, ["event", "action"], "hook");
    if (hook.event !== "post.published") reject("Unsupported hook event; use post.published.");
    if (!actions.has(hook.action)) reject("Hook action must reference a declared action.");
    const key = `${hook.event}:${hook.action}`;
    if (seen.has(key)) reject("Duplicate hook.");
    seen.add(key);
  }
}
function validateCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length > 32) reject("Provide an array of at most 32 capabilities.");
  const seen = new Set();
  for (const name of capabilities) {
    text(name, 1, 80, "capability");
    if (!actionName.test(name) || seen.has(name)) reject("Capabilities must have unique lowercase names.");
    seen.add(name);
  }
}

function validateHTTP(http) {
  keys(http, ["method", "path", "reader"], "action.http");
  if (!["GET", "POST"].includes(http.method)) reject("HTTP actions use GET or POST.");
  if (typeof http.reader !== "boolean") reject("HTTP reader permission must be explicit.");
  if (typeof http.path !== "string" || http.path.length > 1024 || !/^\/(?!\/)[a-zA-Z0-9_./-]*$/.test(http.path) || http.path.split("/").some(part => part === "." || part === "..")) reject("HTTP action path must be a clean relative server path without query or credentials.");
}
