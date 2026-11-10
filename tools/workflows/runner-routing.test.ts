import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDirectory = join(import.meta.dir, "..", "..", ".github", "workflows");

const routedExpression =
  "${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest' }}";
const routedMatrixExpression =
  "${{ matrix.os == 'ubuntu-latest' && (github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest') || matrix.os }}";

/** Jobs routed through `vars.BLACKSMITH_RUNNER`, as `<file>:<job>`; every other job uses a literal label. */
export const routedJobs: readonly string[] = [
  "ci.yml:check",
  "ci.yml:test",
  "ci.yml:commitlint",
  "determinism.yml:compare",
];

const jobLine = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const topLevelLine = /^\S/;
const runsOnLine = /^ {4}runs-on:\s*(.*?)\s*$/;
const osMatrixLine = /^\s+os:\s*(?:\[|$)/;
const literalLabel = /^(?:ubuntu-latest|ubuntu-24\.04-arm|macos-[A-Za-z0-9.-]+|windows-latest)$/;
const forbiddenLabel = /vps-|self-hosted/;
const matrixRunnerExpression = "${{ matrix.runner }}";
const matrixOsExpression = "${{ matrix.os }}";
const literalLabelProblem =
  "must use a literal ubuntu-latest, ubuntu-24.04-arm, macos-* or windows-latest label";

interface WorkflowJob {
  name: string;
  runsOn: string | undefined;
  hasOsMatrix: boolean;
  matrixRunners: unknown[];
  matrixOses: unknown[];
}

/** Lists every value of a job's matrix `key`, from a `key` list and from `include` entries. */
function listMatrixValues(parsedWorkflow: unknown, job: string, key: string): unknown[] {
  const matrix = field(field(field(field(parsedWorkflow, "jobs"), job), "strategy"), "matrix");
  const listed: unknown = field(matrix, key);
  const included: unknown = field(matrix, "include");
  const values: unknown[] = [];
  if (Array.isArray(listed)) values.push(...(listed as unknown[]));
  if (Array.isArray(included)) {
    for (const entry of included as unknown[]) values.push(field(entry, key));
  }
  return values;
}

/** The matrix key a `runs-on: ${{ matrix.<key> }}` expression reads, or undefined for any other `runs-on`. */
function matrixLabelKey(runsOn: string | undefined): "runner" | "os" | undefined {
  if (runsOn === matrixRunnerExpression) return "runner";
  if (runsOn === matrixOsExpression) return "os";
  return undefined;
}

function findLiteralLabelProblem(id: string, job: WorkflowJob): string | undefined {
  const key = matrixLabelKey(job.runsOn);
  if (key === undefined) {
    return literalLabel.test(job.runsOn ?? "")
      ? undefined
      : `${id} is not routed and ${literalLabelProblem}`;
  }
  const labels = key === "runner" ? job.matrixRunners : job.matrixOses;
  const allLiteral =
    labels.length > 0 &&
    labels.every((label) => typeof label === "string" && literalLabel.test(label));
  return allLiteral
    ? undefined
    : `${id} is not routed and every matrix.${key} ${literalLabelProblem}`;
}

function parseJobs(text: string): WorkflowJob[] {
  const jobs: WorkflowJob[] = [];
  let insideJobs = false;
  let current: WorkflowJob | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (topLevelLine.test(line)) {
      insideJobs = line === "jobs:";
      current = undefined;
      continue;
    }
    if (!insideJobs) continue;
    const jobMatch = jobLine.exec(line);
    if (jobMatch !== null) {
      current = {
        name: jobMatch[1] ?? "",
        runsOn: undefined,
        hasOsMatrix: false,
        matrixRunners: [],
        matrixOses: [],
      };
      jobs.push(current);
      continue;
    }
    if (current === undefined) continue;
    const runsOnMatch = runsOnLine.exec(line);
    if (runsOnMatch !== null) current.runsOn = runsOnMatch[1];
    if (osMatrixLine.test(line)) current.hasOsMatrix = true;
  }
  return jobs;
}

function findJobProblem(id: string, job: WorkflowJob, routed: boolean): string | undefined {
  const runsOn = job.runsOn;
  if (runsOn === undefined) return `${id} has no runs-on`;
  if (forbiddenLabel.test(runsOn)) return `${id} uses a forbidden runner label ${runsOn}`;
  if (!routed) return findLiteralLabelProblem(id, job);
  const expected = job.hasOsMatrix ? routedMatrixExpression : routedExpression;
  if (runsOn === expected) return undefined;
  return job.hasOsMatrix
    ? `${id} is routed and must use the os matrix form of the BLACKSMITH_RUNNER expression`
    : `${id} is routed and must use the BLACKSMITH_RUNNER expression`;
}

/** Returns `<file>:<job>` descriptions of every job whose `runs-on` breaks the CI runner routing rules. */
export function findRunnerRoutingProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  const parsedWorkflow: unknown = Bun.YAML.parse(text);
  const jobs = parseJobs(text);
  for (const job of jobs) {
    job.matrixRunners = listMatrixValues(parsedWorkflow, job.name, "runner");
    job.matrixOses = listMatrixValues(parsedWorkflow, job.name, "os");
    const id = `${file}:${job.name}`;
    const problem = findJobProblem(id, job, routedJobs.includes(id));
    if (problem !== undefined) problems.push(problem);
  }
  for (const id of routedJobs.filter((entry) => entry.startsWith(`${file}:`))) {
    if (!jobs.some((job) => `${file}:${job.name}` === id))
      problems.push(`${id} is listed in routedJobs but missing`);
  }
  text.split("\n").forEach((line, index) => {
    if (!line.includes("vars.BLACKSMITH_RUNNER")) return;
    const runsOn = runsOnLine.exec(line.trimEnd())?.[1];
    if (runsOn !== routedExpression && runsOn !== routedMatrixExpression) {
      problems.push(
        `${file}:${index + 1} uses vars.BLACKSMITH_RUNNER outside a runs-on routing expression`,
      );
    }
  });
  return problems;
}

function workflow(job: string, runsOn: string, extra = ""): string {
  return `name: CI\n\njobs:\n  ${job}:\n    name: ${job}\n${extra}    runs-on: ${runsOn}\n    steps:\n      - run: true\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function jobSteps(jobs: unknown, job: string): unknown[] {
  const steps = field(field(jobs, job), "steps");
  return Array.isArray(steps) ? steps : [];
}

function stepRuns(jobs: unknown, job: string): string[] {
  return jobSteps(jobs, job).flatMap((step: unknown) => {
    const run = field(step, "run");
    return typeof run === "string" ? [run] : [];
  });
}

/** The routed `ci.yml` jobs besides `test`, so a `test` fixture is a complete `ci.yml`. */
const ciSiblingJobs = `  check:\n    runs-on: ${routedExpression}\n  commitlint:\n    runs-on: ${routedExpression}\n`;

function ciWorkflow(testRunsOn: string, matrix: string): string {
  return `${workflow("test", testRunsOn, matrix)}${ciSiblingJobs}`;
}

const osMatrix = "    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n";

describe("CI runner routing", () => {
  test("every workflow job follows the BLACKSMITH_RUNNER routing rules", () => {
    const files = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((name) =>
      findRunnerRoutingProblems(name, readFileSync(join(workflowsDirectory, name), "utf8")),
    );
    expect(problems).toEqual([]);
  });

  test("every routed job exists in a workflow file", () => {
    const files = new Set(readdirSync(workflowsDirectory));
    expect(routedJobs.filter((id) => !files.has(id.split(":")[0] ?? ""))).toEqual([]);
  });

  test("a routed job on a literal ubuntu-latest fails and names file and job", () => {
    expect(
      findRunnerRoutingProblems("determinism.yml", workflow("compare", "ubuntu-latest")),
    ).toEqual(["determinism.yml:compare is routed and must use the BLACKSMITH_RUNNER expression"]);
  });

  test.each([
    ["real-build.yml", "build"],
    ["docker.yml", "smoke"],
    ["upgrade.yml", "upgrade"],
    ["distribution.yml", "linux-x64"],
    ["determinism.yml", "digest"],
  ])("%s %s is not routed and fails on the routing expression", (file, job) => {
    expect(findRunnerRoutingProblems(file, workflow(job, routedExpression))).toContain(
      `${file}:${job} is not routed and ${literalLabelProblem}`,
    );
  });

  test("a matrix.os job passes when every os in the matrix is a literal label", () => {
    expect(
      findRunnerRoutingProblems("other.yml", workflow("job", matrixOsExpression, osMatrix)),
    ).toEqual([]);
  });

  test("a matrix.os job with a self-hosted os fails", () => {
    const matrix = "    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n";
    expect(
      findRunnerRoutingProblems("other.yml", workflow("job", matrixOsExpression, matrix)),
    ).toEqual([`other.yml:job is not routed and every matrix.os ${literalLabelProblem}`]);
  });

  test("a self-hosted label fails and names file and job", () => {
    expect(findRunnerRoutingProblems("upgrade.yml", workflow("upgrade", "self-hosted"))).toEqual([
      "upgrade.yml:upgrade uses a forbidden runner label self-hosted",
    ]);
  });

  test("a vps label fails even on a job that is not routed", () => {
    expect(findRunnerRoutingProblems("other.yml", workflow("job", "vps-runner"))).toEqual([
      "other.yml:job uses a forbidden runner label vps-runner",
    ]);
  });

  test("a routed job using the routing expression passes", () => {
    expect(
      findRunnerRoutingProblems("determinism.yml", workflow("compare", routedExpression)),
    ).toEqual([]);
  });

  test("an os matrix job using the matrix form passes", () => {
    const text = ciWorkflow(routedMatrixExpression, osMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([]);
  });

  test("an os matrix job using the plain expression fails so macOS never reaches Blacksmith", () => {
    const text = ciWorkflow(routedExpression, osMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([
      "ci.yml:test is routed and must use the os matrix form of the BLACKSMITH_RUNNER expression",
    ]);
  });

  test("a block-style os matrix using the plain expression fails", () => {
    const blockMatrix =
      "    strategy:\n      matrix:\n        os:\n          - ubuntu-latest\n          - macos-latest\n";
    const text = ciWorkflow(routedExpression, blockMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([
      "ci.yml:test is routed and must use the os matrix form of the BLACKSMITH_RUNNER expression",
    ]);
  });

  test("a job that is not routed must use a literal label", () => {
    expect(findRunnerRoutingProblems("other.yml", workflow("job", "macos-latest"))).toEqual([]);
    expect(findRunnerRoutingProblems("other.yml", workflow("job", "ubuntu-24.04-arm"))).toEqual([]);
    expect(findRunnerRoutingProblems("other.yml", workflow("job", routedExpression))).toEqual([
      "other.yml:job is not routed and must use a literal ubuntu-latest, ubuntu-24.04-arm, macos-* or windows-latest label",
    ]);
  });

  test("a matrix.runner job passes when every runner in the matrix is a literal label", () => {
    const matrix =
      "    strategy:\n      matrix:\n        include:\n          - runner: ubuntu-24.04-arm\n          - runner: macos-latest\n";
    expect(
      findRunnerRoutingProblems("other.yml", workflow("job", matrixRunnerExpression, matrix)),
    ).toEqual([]);
  });

  test.each([
    [
      "a self-hosted label",
      "        include:\n          - runner: ubuntu-latest\n          - runner: self-hosted-arm\n",
    ],
    ["a vps label in list form", "        runner: [ubuntu-latest, vps-box]\n"],
    ["no runner at all", "        include:\n          - target: bun-linux-x64\n"],
  ])("a matrix.runner job with %s in the matrix fails", (_label, entries) => {
    const matrix = `    strategy:\n      matrix:\n${entries}`;
    expect(
      findRunnerRoutingProblems("other.yml", workflow("job", matrixRunnerExpression, matrix)),
    ).toEqual([
      "other.yml:job is not routed and every matrix.runner must use a literal ubuntu-latest, ubuntu-24.04-arm, macos-* or windows-latest label",
    ]);
  });

  test("vars.BLACKSMITH_RUNNER outside a runs-on expression fails", () => {
    const text = `${workflow("compare", routedExpression)}        env:\n          RUNNER: \${{ vars.BLACKSMITH_RUNNER }}\n`;
    expect(findRunnerRoutingProblems("determinism.yml", text)).toEqual([
      "determinism.yml:10 uses vars.BLACKSMITH_RUNNER outside a runs-on routing expression",
    ]);
  });

  test("a ci.yml without the split jobs reports each one missing", () => {
    const text = workflow("check-and-test", routedMatrixExpression, osMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([
      "ci.yml:check-and-test is not routed and must use a literal ubuntu-latest, ubuntu-24.04-arm, macos-* or windows-latest label",
      "ci.yml:check is listed in routedJobs but missing",
      "ci.yml:test is listed in routedJobs but missing",
      "ci.yml:commitlint is listed in routedJobs but missing",
    ]);
  });

  test("ci.yml splits into parallel check, test and commitlint jobs gated by ci-passed", () => {
    const text = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");
    expect(parseJobs(text).map((job) => job.name)).toEqual([
      "check",
      "test",
      "commitlint",
      "ci-passed",
    ]);
    const jobs = field(Bun.YAML.parse(text), "jobs");
    expect(stepRuns(jobs, "check")).toContain("bun run check");
    expect(stepRuns(jobs, "check")).not.toContain("bun run test");
    expect(stepRuns(jobs, "test")).toContain("bun run test");
    expect(stepRuns(jobs, "test")).not.toContain("bun run check");
    expect(field(field(jobs, "check"), "needs")).toBeUndefined();
    expect(field(field(jobs, "test"), "needs")).toBeUndefined();
    const commitlint = field(jobs, "commitlint");
    expect(field(commitlint, "if")).toBe("github.event_name == 'pull_request'");
    const checkoutInputs = field(jobSteps(jobs, "commitlint")[0], "with");
    expect(field(checkoutInputs, "fetch-depth")).toBe(0);
    expect(field(checkoutInputs, "filter")).toBe("blob:none");
    expect(stepRuns(jobs, "commitlint")).toContain(
      "bun install --frozen-lockfile --ignore-scripts",
    );
    expect(stepRuns(jobs, "commitlint")).toContain(
      'bunx commitlint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose',
    );
    const gate = field(jobs, "ci-passed");
    expect(field(gate, "if")).toBe("always()");
    expect(field(gate, "needs")).toEqual(["check", "test", "commitlint"]);
  });

  test.each([
    ["success", "success", "success", 0],
    ["success", "success", "skipped", 0],
    ["success", "skipped", "success", 1],
    ["success", "cancelled", "success", 1],
    ["failure", "success", "success", 1],
    ["", "success", "success", 1],
    ["success", "success", "failure", 1],
    ["success", "success", "cancelled", 1],
    ["success", "success", "", 1],
  ])(
    'ci-passed treats check="%s" test="%s" commitlint="%s" as exit %d',
    (check, testResult, commitlint, expectedExit) => {
      const text = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");
      const script = stepRuns(field(Bun.YAML.parse(text), "jobs"), "ci-passed").join("\n");
      const outcome = Bun.spawnSync(["sh", "-c", script], {
        env: { CHECK_RESULT: check, TEST_RESULT: testResult, COMMITLINT_RESULT: commitlint },
      });
      expect(outcome.exitCode).toBe(expectedExit);
    },
  );

  test("ci-passed reads each needed job result through its own env variable", () => {
    const text = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");
    const steps = jobSteps(field(Bun.YAML.parse(text), "jobs"), "ci-passed");
    expect(steps.map((step) => field(step, "env"))).toEqual([
      {
        CHECK_RESULT: "${{ needs.check.result }}",
        TEST_RESULT: "${{ needs.test.result }}",
        COMMITLINT_RESULT: "${{ needs.commitlint.result }}",
      },
    ]);
  });

  test("a routed job missing from its file is reported", () => {
    expect(
      findRunnerRoutingProblems("determinism.yml", workflow("renamed", "ubuntu-latest")),
    ).toEqual(["determinism.yml:compare is listed in routedJobs but missing"]);
  });
});
