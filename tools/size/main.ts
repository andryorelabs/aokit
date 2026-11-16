import { join } from "node:path";

import { measureSizes } from "./measure.ts";
import { findSizeFailures, loadSizeBudgets } from "./size-budget.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const budgets = loadSizeBudgets();
const measured = await measureSizes(repoRoot, budgets);
const failures = findSizeFailures(measured, budgets);

for (const failure of failures) console.error(failure);
if (failures.length > 0) process.exit(1);

const checked = Object.keys(measured.packages).length + Object.keys(measured.binaries).length;
console.log(`Size budgets met for ${checked} artifacts.`);
