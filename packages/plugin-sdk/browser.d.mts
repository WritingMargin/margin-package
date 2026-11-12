export interface ImportTextFileOptions { accept?: string; maxBytes?: number; signal?: AbortSignal }
export interface ImportedTextFile { name: string; text: string }
export interface BlockContext {
  readonly mode: "edit" | "preview" | "read";
  readonly source: string;
  readonly actions?: readonly string[];
  readonly readerActions?: readonly string[];
  readonly theme: Readonly<{ background: string; foreground: string; muted: string; accent: string; border: string; fontFamily: string }>;
}
export interface BlockAPI {
  readonly context: BlockContext;
  /** Calls only an action declared by this block; readers may call only explicitly permitted HTTP actions. */
  action<T = Record<string, unknown>>(name: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T>;
  /** Stage source in the block editor. Margin's Insert/Apply button commits it. */
  change(source: string): void;
  resize(height: number): void;
  /** Register one declared action to release resources when this frame closes. */
  setCleanup(action: string | null, input?: Record<string, unknown>): void;
  /** Offer a file download through a user-clicked host control. */
  download(name: string, mime: string, text: string): void;
  /** Ask the author to choose a bounded text file using Margin’s native picker. Editor only. */
  importTextFile(options?: ImportTextFileOptions): Promise<ImportedTextFile | null>;
  close(): void;
}
export function connectBlock(): Promise<BlockAPI>;
export class BlockClient implements BlockAPI {
  constructor(port: MessagePort, context: BlockContext);
  readonly context: BlockContext;
  action<T = Record<string, unknown>>(name: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T>;
  change(source: string): void;
  resize(height: number): void;
  setCleanup(action: string | null, input?: Record<string, unknown>): void;
  download(name: string, mime: string, text: string): void;
  /** Ask the author to choose a bounded text file using Margin’s native picker. Editor only. */
  importTextFile(options?: ImportTextFileOptions): Promise<ImportedTextFile | null>;
  close(): void;
}
