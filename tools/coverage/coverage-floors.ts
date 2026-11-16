import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimum line and function coverage, as fractions.
 */
export interface Floor {
  readonly lines: number;
  readonly functions: number;
}

/**
 * The committed floors: the "All files" floor and one floor per workspace, keyed by workspace path.
 * Files outside `packages/*` belong to the workspace named by their first path segment, and root files to `.`.
 */
export interface CoverageFloors {
  readonly all: Floor;
  readonly workspaces: Readonly<Record<string, Floor>>;
}

/**
 * Path of the JSON file that holds the coverage floors.
 */
const COVERAGE_FLOORS_PATH = join(import.meta.dir, "coverage-floors.json");

function isFraction(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function parseFloor(value: unknown, label: string): Floor {
  if (
    typeof value !== "object" ||
    value === null ||
    !("lines" in value) ||
    !("functions" in value) ||
    !isFraction(value.lines) ||
    !isFraction(value.functions)
  ) {
    throw new Error(`Coverage floor ${label} needs "lines" and "functions" fractions in [0, 1].`);
  }
  return { lines: value.lines, functions: value.functions };
}

/**
 * Parses the text of a coverage floors file and throws on a malformed entry.
 */
export function parseCoverageFloors(text: string): CoverageFloors {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("all" in parsed) ||
    !("workspaces" in parsed) ||
    typeof parsed.workspaces !== "object" ||
    parsed.workspaces === null
  ) {
    throw new Error('The coverage floors file needs "all" and "workspaces".');
  }
  const workspaces: Record<string, Floor> = {};
  for (const [name, floor] of Object.entries(parsed.workspaces)) {
    workspaces[name] = parseFloor(floor, name);
  }
  return { all: parseFloor(parsed.all, "all"), workspaces };
}

/**
 * Reads and parses the coverage floors file.
 */
export function loadCoverageFloors(path: string = COVERAGE_FLOORS_PATH): CoverageFloors {
  return parseCoverageFloors(readFileSync(path, "utf8"));
}

/**
 * The workspace a source path belongs to: `packages/<name>` under `packages/`, the first segment elsewhere, `.` at the root.
 */
export function workspaceOf(path: string): string {
  const segments = path.split("/");
  if (segments.length === 1) return ".";
  return segments[0] === "packages" && segments.length > 2
    ? `${segments[0]}/${segments[1]}`
    : (segments[0] ?? ".");
}
