import type { targetSchema } from "@aokit/module";
import type { z } from "zod";
import { EngineError } from "./errors.ts";

/** A logical destination a Module writes to. */
export type Target = z.output<typeof targetSchema>;

/** The two supported Layouts. */
export type LayoutName = "single" | "monorepo";

/** Layout resolution tables: Target to directory relative to the Project root ("" is the root). */
export const layoutTables: Readonly<Record<LayoutName, Readonly<Record<Target, string>>>> = {
  single: {
    root: "",
    config: "",
    web: "src",
    server: "src/server",
    db: "src/db",
    "shared-ui": "src/components",
  },
  monorepo: {
    root: "",
    config: "packages/config",
    web: "apps/web",
    server: "apps/server",
    db: "packages/db",
    "shared-ui": "packages/ui",
  },
};

/**
 * Resolves a Target to its directory under a Layout. An unresolvable Target fails naming the
 * Target and the Modules that write to it.
 */
export function resolveTarget(
  layout: LayoutName,
  target: string,
  writers: readonly string[] = [],
): string {
  const table: Readonly<Record<string, string>> = layoutTables[layout];
  const directory = Object.hasOwn(table, target) ? table[target] : undefined;
  if (directory === undefined) {
    const who = writers.length > 0 ? ` (written by ${writers.join(", ")})` : "";
    throw new EngineError(
      "engine.layout-unresolvable",
      `Target "${target}"${who} cannot be resolved by the "${layout}" Layout. Use a Layout that resolves it; Modules cannot change the Layout.`,
      writers,
    );
  }
  return directory;
}
