import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Maximum sizes in bytes: packed tarballs keyed by package directory, compiled binaries keyed by file name.
 */
export interface SizeBudgets {
  readonly packages: Readonly<Record<string, number>>;
  readonly binaries: Readonly<Record<string, number>>;
}

/**
 * Measured sizes in bytes, keyed like {@link SizeBudgets}.
 */
export interface SizeMeasurements {
  readonly packages: Readonly<Record<string, number>>;
  readonly binaries: Readonly<Record<string, number>>;
}

/**
 * Path of the JSON file that holds the size budgets.
 */
const SIZE_BUDGETS_PATH = join(import.meta.dir, "size-budgets.json");

function parseBudgetGroup(value: unknown, label: string): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`The size budgets file needs a "${label}" object.`);
  }
  const group: Record<string, number> = {};
  for (const [name, limit] of Object.entries(value)) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw new Error(`Size budget ${label}/${name} must be a positive integer of bytes.`);
    }
    group[name] = limit;
  }
  return group;
}

/**
 * Parses the text of a size budgets file and throws on a malformed entry.
 */
export function parseSizeBudgets(text: string): SizeBudgets {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error('The size budgets file needs "packages" and "binaries".');
  }
  return {
    packages: parseBudgetGroup("packages" in parsed ? parsed.packages : undefined, "packages"),
    binaries: parseBudgetGroup("binaries" in parsed ? parsed.binaries : undefined, "binaries"),
  };
}

/**
 * Reads and parses the size budgets file.
 */
export function loadSizeBudgets(path: string = SIZE_BUDGETS_PATH): SizeBudgets {
  return parseSizeBudgets(readFileSync(path, "utf8"));
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} bytes`;
}

function findGroupFailures(
  kind: string,
  measured: Readonly<Record<string, number>>,
  allowed: Readonly<Record<string, number>>,
): string[] {
  const failures: string[] = [];
  for (const [name, size] of Object.entries(measured)) {
    const limit = allowed[name];
    if (limit === undefined) {
      failures.push(`${kind} ${name} has no entry in size-budgets.json; add its budget.`);
    } else if (size > limit) {
      failures.push(
        `${kind} ${name} is ${formatBytes(size)}, over its budget: measured ${formatBytes(size)}, allowed ${formatBytes(limit)}.`,
      );
    }
  }
  return failures;
}

/**
 * Lists one message per measured item that is over its budget or has none, with the measured and allowed size.
 * Empty when every measured item is within budget.
 */
export function findSizeFailures(measured: SizeMeasurements, budgets: SizeBudgets): string[] {
  return [
    ...findGroupFailures("Package", measured.packages, budgets.packages),
    ...findGroupFailures("Binary", measured.binaries, budgets.binaries),
  ];
}
