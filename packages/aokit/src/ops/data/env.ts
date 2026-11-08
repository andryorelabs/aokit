import type { ModuleManifest, Op } from "@aokit/module";
import type { DeclaredExtensionPoint, OpVfs } from "../../engine/ops.ts";
import { addEnv } from "../../patchers/env/index.ts";
import { readText, writeIfChanged } from "./files.ts";

/** Inputs of {@link applyEnv}. */
interface ApplyEnvOptions {
  readonly vfs: OpVfs;
  readonly env: ModuleManifest["env"];
  resolvePath(target: string, relativePath: string): string;
}

/**
 * Applies a Module's `env` field: each entry's `example` (or an empty value) is added to the
 * `.env` of its scope Target. An existing key is never overwritten.
 */
export function applyEnv(options: ApplyEnvOptions): void {
  const byFile = new Map<string, Record<string, string>>();
  for (const entry of options.env) {
    const path = options.resolvePath(entry.scope, ".env");
    byFile.set(path, { ...byFile.get(path), [entry.key]: entry.example ?? "" });
  }
  for (const [path, entries] of byFile) {
    writeIfChanged(options.vfs, path, addEnv(readText(options.vfs, path), entries));
  }
}

/** The `registerAt` Op the engine derives from one `env[].schema`. */
export type EnvSchemaOp = Extract<Op, { op: "registerAt" }>;

/**
 * Derives the `registerAt` Ops for the `env[].schema` entries of a Module. An entry registers
 * `KEY: <schema>` at `env.server` (the default) or `env.client` when a selected Module declares
 * that Extension point on the `config` Target; without it the schema is skipped.
 */
export function envSchemaOps(
  env: ModuleManifest["env"],
  extensionPoints: ReadonlyMap<string, DeclaredExtensionPoint>,
): EnvSchemaOp[] {
  const ops: EnvSchemaOp[] = [];
  for (const entry of env) {
    if (entry.schema === undefined) {
      continue;
    }
    const name = `env.${entry.visibility ?? "server"}`;
    const point = extensionPoints.get(name);
    if (point === undefined || point.target !== "config") {
      continue;
    }
    ops.push({
      op: "registerAt",
      target: point.target,
      extensionPoint: name,
      range: "*",
      key: entry.key,
      expression: entry.schema,
    });
  }
  return ops;
}
