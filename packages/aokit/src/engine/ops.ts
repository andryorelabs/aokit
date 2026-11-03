import type { ModuleManifest, Op } from "@aokit/module";
import { EngineError } from "./errors.ts";
import type { AnswerValue } from "./interpolate.ts";
import type { LayoutName } from "./layout.ts";
import type { FileContent, WriteOptions } from "./vfs.ts";

/** Injected values passed to every Module and Op; the Engine never reads globals. */
export interface EngineContext {
  readonly now: Date;
  readonly random: () => number;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** A Module as the Engine sees it: its manifest plus access to the files it ships. */
export interface EngineModule {
  readonly manifest: ModuleManifest;
  readFile(from: string): FileContent;
}

/** An Extension point declared by a selected Module. */
export interface DeclaredExtensionPoint {
  readonly module: string;
  readonly name: string;
  readonly version: string;
  readonly target: string;
  readonly kind: string;
  readonly anchor: string;
}

/** The slice of the VFS an Op handler may use; every write is recorded in the Plan's Provenance. */
export interface OpVfs {
  has(path: string): boolean;
  read(path: string): FileContent | undefined;
  write(path: string, content: FileContent, options?: WriteOptions): void;
}

/** Everything an Op handler receives. */
export interface OpContext {
  readonly module: string;
  readonly layout: LayoutName;
  readonly context: EngineContext;
  readonly answers: Readonly<Record<string, AnswerValue>>;
  readonly vfs: OpVfs;
  readonly extensionPoints: ReadonlyMap<string, DeclaredExtensionPoint>;
  /** Joins a Target's Layout directory with a path relative to it. */
  resolvePath(target: string, relativePath: string): string;
}

/** Applies one Op to the VFS. */
export type OpHandler = (context: OpContext, op: Op) => void | Promise<void>;

/** Op handlers keyed by Op name. */
export type OpHandlers = Readonly<Record<string, OpHandler>>;

/** Merges Op handler maps; two handlers for one Op name are a bug and fail. */
export function createOpRegistry(
  ...sources: readonly OpHandlers[]
): ReadonlyMap<string, OpHandler> {
  const registry = new Map<string, OpHandler>();
  for (const source of sources) {
    for (const [name, handler] of Object.entries(source)) {
      if (registry.has(name)) {
        throw new EngineError("engine.duplicate-op-handler", `Op "${name}" has two handlers.`);
      }
      registry.set(name, handler);
    }
  }
  return registry;
}
