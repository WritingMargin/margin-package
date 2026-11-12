export type JSONValue = string | number | boolean | null | readonly JSONValue[] | { readonly [key: string]: JSONValue };
type Annotations = { readonly title?: string; readonly description?: string; readonly enum?: readonly JSONValue[] };
export type Schema = Annotations & (
  | { readonly type: "object"; readonly properties?: Readonly<Record<string, Schema>>; readonly required?: readonly string[]; readonly additionalProperties?: boolean }
  | { readonly type: "array"; readonly items: Schema; readonly minItems?: number; readonly maxItems?: number }
  | { readonly type: "string"; readonly minLength?: number; readonly maxLength?: number }
  | { readonly type: "number" | "integer"; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: "boolean" }
);
export type ObjectSchema = Extract<Schema, { type: "object" }>;
export interface ActionManifest {
  readonly name: string; readonly title: string; readonly description?: string;
  readonly inputSchema: ObjectSchema; readonly outputSchema: ObjectSchema;
  readonly http: { readonly method: "GET" | "POST"; readonly path: string; readonly reader: boolean };
}
export interface PluginManifest {
  readonly apiVersion: "margin.plugin/v1";
  readonly id: string; readonly name: string; readonly version: string; readonly description: string;
  readonly capabilities: readonly string[];
  readonly actions: readonly ActionManifest[];
  readonly hooks?: readonly { readonly event: "post.published"; readonly action: string }[];
  readonly blocks?: readonly BlockManifest[];
}
export interface BlockManifest {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Exact path within the package to one self-contained HTML document. */
  readonly entry: string;
  readonly defaultSource?: string;
  /** Only these actions are available to this block in edit/preview mode. */
  readonly actions: readonly string[];
  /** Allow the installed UI to render saved source on public articles. */
  readonly reader?: boolean;
}
export interface Plugin { readonly manifest: PluginManifest }
type RequiredKeys<S, P> = S extends { readonly required: readonly (infer K)[] } ? Extract<K, keyof P> : never;
type ObjectValue<S, P> = { [K in RequiredKeys<S, P>]: SchemaValue<P[K]> } & { [K in Exclude<keyof P, RequiredKeys<S, P>>]?: SchemaValue<P[K]> };
/** Derive request and response types from declarative schemas. */
export type SchemaValue<S> = S extends { readonly type: "string" } ? string
  : S extends { readonly type: "number" | "integer" } ? number
  : S extends { readonly type: "boolean" } ? boolean
  : S extends { readonly type: "array"; readonly items: infer Item } ? SchemaValue<Item>[]
  : S extends { readonly type: "object"; readonly properties: infer P } ? ObjectValue<S, P>
  : S extends { readonly type: "object" } ? Record<string, unknown>
  : unknown;
export function defineAction<const Input extends ObjectSchema, const Output extends ObjectSchema>(definition: Omit<ActionManifest, "inputSchema" | "outputSchema"> & { inputSchema: Input; outputSchema: Output }): ActionManifest & { readonly inputSchema: Input; readonly outputSchema: Output };
export function definePlugin(definition: Omit<PluginManifest, "apiVersion">): Plugin;
export class PluginValidationError extends Error {}
export function validateManifest(manifest: unknown): PluginManifest;
export function validateSchema(schema: unknown): Schema;
export function validateValue(schema: Schema, value: unknown, path?: string): unknown;
