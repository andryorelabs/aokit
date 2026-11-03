import type { ModuleManifest } from "@aokit/module";
import type { OpVfs } from "../../engine/ops.ts";
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
