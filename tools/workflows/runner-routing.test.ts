import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDirectory = join(import.meta.dir, "..", "..", ".github", "workflows");

const routedExpression =
  "${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest' }}";
const routedMatrixExpression =
  "${{ matrix.os == 'ubuntu-latest' && (github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest') || matrix.os }}";

/** Jobs routed through `vars.BLACKSMITH_RUNNER`, as `<file>:<job>`; while aokit is private this is every Linux job. */
export const routedJobs: readonly string[] = [
  "ci.yml:check-and-test",
  "determinism.yml:digest",
  "determinism.yml:compare",
  "distribution.yml:linux-x64",
  "docker.yml:smoke",
  "real-build.yml:build",
  "upgrade.yml:upgrade",
];

const jobLine = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const topLevelLine = /^\S/;
const runsOnLine = /^ {4}runs-on:\s*(.*?)\s*$/;
const osMatrixLine = /^\s+os:\s*\[/;
const literalLabel = /^(?:ubuntu-latest|macos-[A-Za-z0-9.-]+)$/;
const forbiddenLabel = /vps-|self-hosted/;

interface WorkflowJob {
  name: string;
  runsOn: string | undefined;
  hasOsMatrix: boolean;
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
      current = { name: jobMatch[1] ?? "", runsOn: undefined, hasOsMatrix: false };
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
  if (!routed) {
    return literalLabel.test(runsOn)
      ? undefined
      : `${id} is not routed and must use a literal ubuntu-latest or macos-* label`;
  }
  const expected = job.hasOsMatrix ? routedMatrixExpression : routedExpression;
  if (runsOn === expected) return undefined;
  return job.hasOsMatrix
    ? `${id} is routed and must use the os matrix form of the BLACKSMITH_RUNNER expression`
    : `${id} is routed and must use the BLACKSMITH_RUNNER expression`;
}

/** Returns `<file>:<job>` descriptions of every job whose `runs-on` breaks the CI runner routing rules. */
export function findRunnerRoutingProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  const jobs = parseJobs(text);
  for (const job of jobs) {
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
    expect(findRunnerRoutingProblems("upgrade.yml", workflow("upgrade", "ubuntu-latest"))).toEqual([
      "upgrade.yml:upgrade is routed and must use the BLACKSMITH_RUNNER expression",
    ]);
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
    expect(findRunnerRoutingProblems("upgrade.yml", workflow("upgrade", routedExpression))).toEqual(
      [],
    );
  });

  test("an os matrix job using the matrix form passes", () => {
    const text = workflow("check-and-test", routedMatrixExpression, osMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([]);
  });

  test("an os matrix job using the plain expression fails so macOS never reaches Blacksmith", () => {
    const text = workflow("check-and-test", routedExpression, osMatrix);
    expect(findRunnerRoutingProblems("ci.yml", text)).toEqual([
      "ci.yml:check-and-test is routed and must use the os matrix form of the BLACKSMITH_RUNNER expression",
    ]);
  });

  test("a job that is not routed must use a literal label", () => {
    expect(findRunnerRoutingProblems("other.yml", workflow("job", "macos-latest"))).toEqual([]);
    expect(findRunnerRoutingProblems("other.yml", workflow("job", routedExpression))).toEqual([
      "other.yml:job is not routed and must use a literal ubuntu-latest or macos-* label",
    ]);
  });

  test("vars.BLACKSMITH_RUNNER outside a runs-on expression fails", () => {
    const text = `${workflow("upgrade", routedExpression)}        env:\n          RUNNER: \${{ vars.BLACKSMITH_RUNNER }}\n`;
    expect(findRunnerRoutingProblems("upgrade.yml", text)).toEqual([
      "upgrade.yml:10 uses vars.BLACKSMITH_RUNNER outside a runs-on routing expression",
    ]);
  });

  test("a routed job missing from its file is reported", () => {
    expect(findRunnerRoutingProblems("upgrade.yml", workflow("renamed", "ubuntu-latest"))).toEqual([
      "upgrade.yml:upgrade is listed in routedJobs but missing",
    ]);
  });
});
