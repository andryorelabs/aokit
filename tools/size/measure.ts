import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { packedSizeOf } from "../build-package/lint.ts";
import type { SizeBudgets, SizeMeasurements } from "./size-budget.ts";

/**
 * Measures every budgeted package with `measurePackage` and every compiled binary found in `binaryDirectory`.
 * A budgeted binary that was not built is left out, so a check run without `build:binary` still passes.
 */
export async function measureSizes(
  repoRoot: string,
  budgets: SizeBudgets,
  measurePackage: (packageDir: string) => Promise<number> = packedSizeOf,
): Promise<SizeMeasurements> {
  const packages: Record<string, number> = {};
  const names = Object.keys(budgets.packages);
  const sizes = await Promise.all(names.map((name) => measurePackage(join(repoRoot, name))));
  for (const [index, name] of names.entries()) packages[name] = sizes[index] ?? 0;
  const binaryDirectory = join(repoRoot, "dist", "bin");
  const binaries: Record<string, number> = {};
  if (existsSync(binaryDirectory)) {
    for (const name of readdirSync(binaryDirectory)) {
      if (name.startsWith("aokit-")) binaries[name] = statSync(join(binaryDirectory, name)).size;
    }
  }
  return { packages, binaries };
}
