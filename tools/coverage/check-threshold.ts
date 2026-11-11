import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CoverageException, coverageExceptions } from "./coverage-exceptions";

/**
 * Minimum "All files" line coverage, as a fraction. Raise it when coverage rises, never lower it.
 */
export const LINE_THRESHOLD = 0.997;

/**
 * Minimum "All files" function coverage, as a fraction. Raise it when coverage rises, never lower it.
 */
export const FUNCTION_THRESHOLD = 0.999;

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
      current = { path: line.slice(3).replaceAll("\\", "/"), lf: 0, lh: 0, fnf: 0, fnh: 0 };
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
 * Per-file floor for lines, as a fraction.
 */
export const FILE_LINE_FLOOR = 0.97;

/**
 * Per-file floor for functions, as a fraction.
 */
export const FILE_FUNCTION_FLOOR = 0.98;

function describeFile(file: FileCoverage): string {
  const lines = percent(fraction(file.linesHit, file.linesFound));
  const functions = percent(fraction(file.functionsHit, file.functionsFound));
  return `${lines} lines and ${functions} functions`;
}

function findFileFailures(
  files: readonly FileCoverage[],
  exceptions: readonly CoverageException[],
): string[] {
  const failures: string[] = [];
  const excepted = new Map(exceptions.map((exception) => [exception.file, exception]));
  for (const file of files) {
    const lines = fraction(file.linesHit, file.linesFound);
    const functions = fraction(file.functionsHit, file.functionsFound);
    const underFloor = lines < FILE_LINE_FLOOR || functions < FILE_FUNCTION_FLOOR;
    const exception = excepted.get(file.path);
    if (exception === undefined) {
      if (underFloor) {
        failures.push(
          `${file.path} has ${describeFile(file)}, below the ${percent(FILE_LINE_FLOOR)} lines and ${percent(FILE_FUNCTION_FLOOR)} functions floor, and has no coverage exception.`,
        );
      }
    } else if (!underFloor) {
      failures.push(
        `Coverage exception for ${file.path} is stale: the file now has ${describeFile(file)}. Remove the exception.`,
      );
    } else if (lines < exception.lines || functions < exception.functions) {
      failures.push(
        `${file.path} has ${describeFile(file)}, below its exception floor of ${percent(exception.lines)} lines and ${percent(exception.functions)} functions.`,
      );
    }
  }
  const reported = new Set(files.map((file) => file.path));
  for (const exception of exceptions) {
    if (!reported.has(exception.file)) {
      failures.push(
        `Coverage exception for ${exception.file} names a file missing from the report.`,
      );
    }
    if (exception.reason.trim() === "") {
      failures.push(`Coverage exception for ${exception.file} has an empty reason.`);
    }
  }
  return failures;
}

/**
 * Lists one message per failed check: an "All files" metric under its threshold, a file under the per-file floor
 * without an exception, and an exception that is stale, missing from the report, unexplained or under its own floor.
 * Empty when the gate passes. Per-file checks run on the files and exceptions passed in.
 */
export function findThresholdFailures(
  summary: CoverageSummary,
  thresholds: { readonly lines: number; readonly functions: number } = {
    lines: LINE_THRESHOLD,
    functions: FUNCTION_THRESHOLD,
  },
  files: readonly FileCoverage[] = [],
  exceptions: readonly CoverageException[] = [],
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
  failures.push(...findFileFailures(files, exceptions));
  return failures;
}

/**
 * Reads `coverage/lcov.info` under `repoRoot` and returns the gate failures, or a single message when the report is missing.
 */
export function checkCoverageReport(
  repoRoot: string,
  exceptions: readonly CoverageException[] = coverageExceptions,
): string[] {
  const reportPath = resolve(repoRoot, "coverage/lcov.info");
  if (!existsSync(reportPath)) {
    return [`No coverage report at ${reportPath}; run bun test with coverage enabled first.`];
  }
  const files = parseLcov(readFileSync(reportPath, "utf8"));
  return findThresholdFailures(
    summarize(files),
    { lines: LINE_THRESHOLD, functions: FUNCTION_THRESHOLD },
    files,
    exceptions,
  );
}
