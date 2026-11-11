import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimum "All files" line coverage, as a fraction. Raise it when coverage rises, never lower it.
 */
export const LINE_THRESHOLD = 0.97;

/**
 * Minimum "All files" function coverage, as a fraction. Raise it when coverage rises, never lower it.
 */
export const FUNCTION_THRESHOLD = 0.98;

/**
 * Coverage of one source file, as reported by an lcov record.
 */
export interface FileCoverage {
  readonly path: string;
  readonly linesFound: number;
  readonly linesHit: number;
  readonly functionsFound: number;
  readonly functionsHit: number;
}

/**
 * The "All files" figures: the mean of the per-file percentages, like Bun's text table.
 */
export interface CoverageSummary {
  readonly lines: number;
  readonly functions: number;
  readonly files: number;
}

/**
 * Parses lcov text into one {@link FileCoverage} per `SF:` record.
 */
export function parseLcov(lcov: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let current: { path: string; lf: number; lh: number; fnf: number; fnh: number } | undefined;
  for (const rawLine of lcov.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      current = { path: line.slice(3), lf: 0, lh: 0, fnf: 0, fnh: 0 };
    } else if (current !== undefined && line.startsWith("LF:")) {
      current.lf = Number(line.slice(3));
    } else if (current !== undefined && line.startsWith("LH:")) {
      current.lh = Number(line.slice(3));
    } else if (current !== undefined && line.startsWith("FNF:")) {
      current.fnf = Number(line.slice(4));
    } else if (current !== undefined && line.startsWith("FNH:")) {
      current.fnh = Number(line.slice(4));
    } else if (current !== undefined && line === "end_of_record") {
      files.push({
        path: current.path,
        linesFound: current.lf,
        linesHit: current.lh,
        functionsFound: current.fnf,
        functionsHit: current.fnh,
      });
      current = undefined;
    }
  }
  return files;
}

function fraction(hit: number, found: number): number {
  return found === 0 ? 1 : hit / found;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Averages the per-file line and function fractions. A file with nothing to measure counts as fully covered.
 */
export function summarize(files: readonly FileCoverage[]): CoverageSummary {
  return {
    lines: mean(files.map((file) => fraction(file.linesHit, file.linesFound))),
    functions: mean(files.map((file) => fraction(file.functionsHit, file.functionsFound))),
    files: files.length,
  };
}

/**
 * Lists one message per metric that is below its threshold; empty when the gate passes.
 */
export function findThresholdFailures(
  summary: CoverageSummary,
  thresholds: { readonly lines: number; readonly functions: number } = {
    lines: LINE_THRESHOLD,
    functions: FUNCTION_THRESHOLD,
  },
): string[] {
  const failures: string[] = [];
  if (summary.files === 0) {
    failures.push("The coverage report lists no files.");
    return failures;
  }
  if (summary.lines < thresholds.lines) {
    failures.push(
      `Line coverage ${percent(summary.lines)} is below the ${percent(thresholds.lines)} threshold.`,
    );
  }
  if (summary.functions < thresholds.functions) {
    failures.push(
      `Function coverage ${percent(summary.functions)} is below the ${percent(thresholds.functions)} threshold.`,
    );
  }
  return failures;
}

/**
 * Reads `coverage/lcov.info` under `repoRoot` and returns the gate failures, or a single message when the report is missing.
 */
export function checkCoverageReport(repoRoot: string): string[] {
  const reportPath = resolve(repoRoot, "coverage/lcov.info");
  if (!existsSync(reportPath)) {
    return [`No coverage report at ${reportPath}; run bun test with coverage enabled first.`];
  }
  return findThresholdFailures(summarize(parseLcov(readFileSync(reportPath, "utf8"))));
}

if (import.meta.main) {
  const failures = checkCoverageReport(resolve(import.meta.dir, "../.."));
  for (const failure of failures) console.error(failure);
  process.exit(failures.length === 0 ? 0 : 1);
}
