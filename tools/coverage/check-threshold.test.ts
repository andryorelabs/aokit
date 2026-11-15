import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type CoverageException, coverageExceptions } from "./coverage-exceptions";
import { type CoverageFloors, loadCoverageFloors } from "./coverage-floors";
import {
  checkCoverageReport,
  FILE_FUNCTION_FLOOR,
  FILE_LINE_FLOOR,
  findThresholdFailures,
  FUNCTION_THRESHOLD,
  LINE_THRESHOLD,
  parseLcov,
  summarize,
} from "./check-threshold";

const record = (path: string, lf: number, lh: number, fnf: number, fnh: number): string =>
  [`SF:${path}`, `FNF:${fnf}`, `FNH:${fnh}`, `LF:${lf}`, `LH:${lh}`, "end_of_record"].join("\n");

const roots: string[] = [];

function reportRoot(lcov: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "aokit-threshold-"));
  roots.push(root);
  if (lcov !== undefined) {
    mkdirSync(join(root, "coverage"));
    writeFileSync(join(root, "coverage/lcov.info"), lcov);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("parseLcov", () => {
  test("reads one entry per record", () => {
    const files = parseLcov(`${record("a.ts", 10, 9, 2, 2)}\n${record("b.ts", 4, 4, 1, 0)}\n`);
    expect(files).toEqual([
      { path: "a.ts", linesFound: 10, linesHit: 9, functionsFound: 2, functionsHit: 2 },
      { path: "b.ts", linesFound: 4, linesHit: 4, functionsFound: 1, functionsHit: 0 },
    ]);
  });

  test("ignores counters outside a record and handles CRLF", () => {
    const files = parseLcov(`LF:3\r\n${record("a.ts", 1, 1, 1, 1).replaceAll("\n", "\r\n")}\r\n`);
    expect(files).toHaveLength(1);
  });
});

describe("summarize", () => {
  test("averages the per-file fractions, not the totals", () => {
    const summary = summarize(
      parseLcov(`${record("a.ts", 100, 100, 1, 1)}\n${record("b.ts", 2, 1, 1, 0)}`),
    );
    expect(summary.lines).toBeCloseTo(0.75);
    expect(summary.functions).toBeCloseTo(0.5);
    expect(summary.files).toBe(2);
  });

  test("counts a file with nothing to measure as fully covered", () => {
    const summary = summarize(parseLcov(record("types.ts", 0, 0, 0, 0)));
    expect(summary.lines).toBe(1);
    expect(summary.functions).toBe(1);
  });
});

describe("findThresholdFailures", () => {
  const at = { lines: LINE_THRESHOLD, functions: FUNCTION_THRESHOLD, files: 1 };

  test("passes at the threshold", () => {
    expect(findThresholdFailures(at)).toEqual([]);
  });

  test("names each metric that is below its threshold", () => {
    const failures = findThresholdFailures({ ...at, lines: 0.5, functions: 0.5 });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("Line coverage 50.00%");
    expect(failures[1]).toContain("Function coverage 50.00%");
  });

  test("fails when the report lists no files", () => {
    expect(findThresholdFailures({ lines: 1, functions: 1, files: 0 })).toHaveLength(1);
  });

  test("honors custom thresholds", () => {
    expect(findThresholdFailures(at, { lines: 1, functions: 0.5 })).toHaveLength(1);
  });
});

describe("gate wiring", () => {
  const repoRoot = resolve(import.meta.dir, "../..");

  test("the test script runs the gate runner", () => {
    expect(readFileSync(join(repoRoot, "package.json"), "utf8")).toMatch(
      /"test":\s*"[^"]*tools\/coverage\/run-tests\.ts/,
    );
  });

  test("bunfig writes the lcov report the gate reads", () => {
    expect(readFileSync(join(repoRoot, "bunfig.toml"), "utf8")).toMatch(
      /coverageReporter\s*=\s*\[[^\]]*"lcov"/,
    );
  });
});

describe("checkCoverageReport", () => {
  test("fails when there is no report", () => {
    expect(checkCoverageReport(reportRoot(undefined))[0]).toContain("No coverage report");
  });

  test("fails on an empty report", () => {
    expect(checkCoverageReport(reportRoot(""))).toEqual(["The coverage report lists no files."]);
  });

  test("passes a report at the thresholds and fails one below them", () => {
    expect(checkCoverageReport(reportRoot(record("a.ts", 100, 100, 100, 100)), [])).toEqual([]);
    expect(checkCoverageReport(reportRoot(record("a.ts", 100, 90, 100, 90)), [])).toHaveLength(5);
  });

  test("applies the committed exceptions by default", () => {
    const failures = checkCoverageReport(reportRoot(record("a.ts", 100, 100, 100, 100)));
    expect(failures).toHaveLength(coverageExceptions.length);
    for (const failure of failures) expect(failure).toContain("missing from the report");
  });

  test("matches an exception against a report that uses backslash paths", () => {
    const covered = Array.from({ length: 49 }, (_, index) =>
      record(`src\\covered-${index}.ts`, 100, 100, 100, 100),
    );
    const lcov = [record("src\\a.ts", 100, 95, 100, 100), ...covered].join("\n");
    const exceptions = [
      { file: "src/a.ts", reason: "reached only by spawned processes", lines: 0.95, functions: 1 },
    ];
    expect(parseLcov(lcov)[0]?.path).toBe("src/a.ts");
    const floors: CoverageFloors = {
      all: loadCoverageFloors().all,
      workspaces: { src: { lines: 0.99, functions: 1 } },
    };
    expect(checkCoverageReport(reportRoot(lcov), exceptions, floors)).toEqual([]);
  });
});

const exception = (overrides: Partial<CoverageException> = {}): CoverageException => ({
  file: "a.ts",
  reason: "reached only by spawned processes",
  lines: 0.9,
  functions: 0.9,
  ...overrides,
});

describe("per-file floor", () => {
  const at = { lines: 0.5, functions: 0.5, files: 1 };
  const loose = { lines: 0, functions: 0 };
  const run = (lcov: string, exceptions: readonly CoverageException[] = []): string[] =>
    findThresholdFailures(at, loose, parseLcov(lcov), exceptions);

  test("fails a file under the line floor and names it with both figures", () => {
    const failures = run(record("a.ts", 1000, 969, 10, 10));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("a.ts");
    expect(failures[0]).toContain("96.90% lines and 100.00% functions");
  });

  test("fails a file under the function floor", () => {
    expect(run(record("a.ts", 100, 100, 100, 97))[0]).toContain("97.00% functions");
  });

  test("passes a file exactly at the floor", () => {
    expect(run(record("a.ts", 100, 97, 100, 98))).toEqual([]);
  });

  test("passes an excepted file at its own floor", () => {
    expect(run(record("a.ts", 100, 90, 100, 90), [exception()])).toEqual([]);
  });

  test("fails a stale exception whose file meets the floor", () => {
    const failures = run(record("a.ts", 100, 98, 100, 100), [exception()]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("stale");
  });

  test("fails an exception whose file is missing from the report", () => {
    const failures = run(record("b.ts", 10, 10, 1, 1), [exception()]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("missing from the report");
  });

  test("fails an exception with an empty reason", () => {
    const failures = run(record("a.ts", 100, 90, 100, 90), [exception({ reason: "  " })]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("empty reason");
  });

  test("fails an excepted file under its own floor", () => {
    const failures = run(record("a.ts", 100, 80, 100, 90), [exception()]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("below its exception floor");
  });

  test("fails an empty report even with exceptions", () => {
    expect(
      findThresholdFailures({ lines: 1, functions: 1, files: 0 }, loose, [], [exception()]),
    ).toEqual(["The coverage report lists no files."]);
  });
});

describe("coverageExceptions", () => {
  test("every entry has a reason and floors under the per-file floor", () => {
    for (const entry of coverageExceptions) {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.lines < FILE_LINE_FLOOR || entry.functions < FILE_FUNCTION_FLOOR).toBe(true);
    }
  });
});

describe("workspace floors", () => {
  const floors: CoverageFloors = {
    all: { lines: 0, functions: 0 },
    workspaces: { "packages/a": { lines: 0.99, functions: 0.99 } },
  };
  const run = (lcov: string): string[] =>
    findThresholdFailures(
      summarize(parseLcov(lcov)),
      floors.all,
      parseLcov(lcov),
      [],
      floors.workspaces,
    );

  test("fails a workspace with no floor entry and names it", () => {
    expect(run(record("packages/b/src/x.ts", 10, 10, 1, 1))).toEqual([
      'Workspace packages/b has no entry in coverage-floors.json; add its floor under "workspaces".',
    ]);
  });

  test("fails a workspace under its floor and passes one at it", () => {
    const failures = run(record("packages/a/src/x.ts", 100, 98, 100, 98));
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("Workspace packages/a line coverage 98.00%");
    expect(run(record("packages/a/src/x.ts", 100, 99, 100, 99))).toEqual([]);
  });

  test("checkCoverageReport fails a workspace missing from the floors", () => {
    const lcov = record("packages/b/src/x.ts", 10, 10, 1, 1);
    expect(checkCoverageReport(reportRoot(lcov), [], floors)[0]).toContain("packages/b");
  });

  test("the committed floors keep the existing thresholds and cover every package", () => {
    const committed = loadCoverageFloors();
    expect(committed.all).toEqual({ lines: 0.997, functions: 0.999 });
    const repoRoot = resolve(import.meta.dir, "../..");
    for (const name of readdirSync(join(repoRoot, "packages"))) {
      expect(committed.workspaces).toHaveProperty([`packages/${name}`]);
    }
  });
});
