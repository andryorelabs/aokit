import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ModuleManifest, parseManifest } from "./manifest.ts";

/**
 * Recursively sorts object keys by Unicode codepoint order; arrays keep their order.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [key, entry] of entries) {
      sorted[key] = sortKeysDeep(entry);
    }
    return sorted;
  }
  return value;
}

/**
 * Serializes data as 2-space JSON with sorted keys and a trailing LF.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/**
 * Result of compiling a Module.
 */
export interface CompiledModule {
  manifest: ModuleManifest;
  json: string;
}

/**
 * Options for {@link compileModule}.
 */
export interface CompileModuleOptions {
  /** When set, `module.json` is written here. */
  outFile?: string;
}

/**
 * Evaluates a TS Module (default export of `defineModule()`) or takes an already-declared one,
 * validates it and returns the sorted `module.json` text, optionally writing it.
 */
export async function compileModule(
  source: string | object,
  options: CompileModuleOptions = {},
): Promise<CompiledModule> {
  let declared: unknown = source;
  if (typeof source === "string") {
    const evaluated: unknown = await import(pathToFileURL(resolve(source)).href);
    declared =
      typeof evaluated === "object" && evaluated !== null && "default" in evaluated
        ? evaluated.default
        : undefined;
  }
  const manifest = parseManifest(declared);
  const json = stableStringify(manifest);
  if (options.outFile !== undefined) {
    await mkdir(dirname(options.outFile), { recursive: true });
    await writeFile(options.outFile, json, "utf8");
  }
  return { manifest, json };
}
