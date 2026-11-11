import { describe, expect, test } from "bun:test";
import { buildSelection } from "./support/index.ts";

const workflowNames = [
  "ci",
  "codeql",
  "labels",
  "lint-docs",
  "lint-pr",
  "lint-workflows",
  "scorecard",
];

const seededPaths = [
  ".github/labels.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
];

/** The `name:` of every job, per workflow, in the order the workflow declares them. */
const jobNames: Record<string, string[]> = {
  ci: ["check", "Commitlint", "CI passed"],
  codeql: ["analyze (${{ matrix.language }})"],
  labels: ["Sync labels"],
  "lint-docs": ["Check markdown links"],
  "lint-pr": ["Validate PR title"],
  "lint-workflows": ["actionlint + zizmor"],
  scorecard: ["scorecard analysis"],
};

const perRunGroupKey = "${{ github.event.pull_request.number || github.sha }}";
const cancelOnPullRequestOnly = "${{ github.event_name == 'pull_request' }}";
const shaPinnedUses = /^\s*(?:- )?uses: [\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

async function renderWorkflows(): Promise<Record<string, string>> {
  const built = await buildSelection(["github-ci"], "single");
  if (!built.ok) throw new Error(built.error.message);
  return Object.fromEntries(
    workflowNames.map((name) => [
      name,
      String(built.plan.vfs.read(`.github/workflows/${name}.yml`)),
    ]),
  );
}

function listSteps(workflow: unknown, job: string): unknown[] {
  const steps = field(field(field(workflow, "jobs"), job), "steps");
  return Array.isArray(steps) ? steps : [];
}

describe("github-ci", () => {
  test.each(["single", "monorepo"] as const)(
    "writes the workflow set, templates and the agents Region (%s)",
    async (layout) => {
      const built = await buildSelection(["github-ci"], layout);
      if (!built.ok) throw new Error(built.error.message);
      const paths = built.plan.vfs.paths();
      const workflows = paths
        .filter((path) => path.startsWith(".github/workflows/"))
        .map((path) => path.slice(".github/workflows/".length, -".yml".length))
        .toSorted();
      expect(workflows).toEqual(workflowNames);
      for (const path of seededPaths) expect(paths).toContain(path);
      const agents = String(built.plan.vfs.read("AGENTS.md"));
      expect(agents).toContain("## github-ci");
      expect(agents).toContain("`.github/workflows/lint-docs.yml`");
      expect(agents).toContain('"Commitlint"');
    },
  );

  test("names every job as the standard rulesets expect", async () => {
    const workflows = await renderWorkflows();
    const rendered = Object.fromEntries(
      workflowNames.map((name) => {
        const jobs = field(Bun.YAML.parse(workflows[name] ?? ""), "jobs");
        return [name, Object.values(isRecord(jobs) ? jobs : {}).map((job) => field(job, "name"))];
      }),
    );
    expect(rendered).toEqual(jobNames);
  });

  test("groups runs per pull request or commit and cancels only on a pull request", async () => {
    const workflows = await renderWorkflows();
    for (const name of workflowNames) {
      const concurrency = field(Bun.YAML.parse(workflows[name] ?? ""), "concurrency");
      expect(field(concurrency, "group")).toBe(`${name}-\${{ github.workflow }}-${perRunGroupKey}`);
      expect(field(concurrency, "cancel-in-progress")).toBe(
        name === "scorecard" ? false : cancelOnPullRequestOnly,
      );
    }
  });

  test("checks markdown links offline with lychee on pull requests and on demand", async () => {
    const workflow: unknown = Bun.YAML.parse((await renderWorkflows())["lint-docs"] ?? "");
    expect(Object.keys(field(workflow, "on") ?? {})).toEqual(["pull_request", "workflow_dispatch"]);
    const lychee = listSteps(workflow, "links").find((step) =>
      String(field(step, "uses")).startsWith("lycheeverse/lychee-action@"),
    );
    expect(field(field(lychee, "with"), "args")).toBe(
      "--offline --include-fragments=anchor-only --no-progress '**/*.md'",
    );
    expect(field(field(lychee, "with"), "fail")).toBe(true);
  });

  test("lints the pull request's commits only when the Project has a commitlint configuration", async () => {
    const workflow: unknown = Bun.YAML.parse((await renderWorkflows())["ci"] ?? "");
    const commitlint = field(field(workflow, "jobs"), "commitlint");
    expect(field(commitlint, "if")).toBe("github.event_name == 'pull_request'");
    const steps = listSteps(workflow, "commitlint");
    const detect = steps.findIndex((step) => field(step, "id") === "config");
    expect(detect).toBeGreaterThan(-1);
    expect(String(field(steps[detect], "run"))).toContain("commitlint.config.*");
    const guarded = steps.slice(detect + 1);
    expect(guarded.length).toBeGreaterThan(0);
    for (const step of guarded) {
      expect(field(step, "if")).toBe("steps.config.outputs.found == 'true'");
    }
    expect(String(field(guarded.at(-1), "run"))).toContain(
      'commitlint --from "$BASE_SHA" --to "$HEAD_SHA"',
    );
    const ciPassed = field(field(workflow, "jobs"), "ci-passed");
    expect(field(ciPassed, "needs")).toEqual(["check", "commitlint"]);
    expect(field(ciPassed, "if")).toBe("always()");
  });

  test("installs the Bun version package.json pins, and the latest when it pins none", async () => {
    const workflows = await renderWorkflows();
    const setups = workflowNames.flatMap((name) => {
      const jobs = field(Bun.YAML.parse(workflows[name] ?? ""), "jobs");
      return Object.keys(isRecord(jobs) ? jobs : {})
        .flatMap((job) => listSteps({ jobs }, job))
        .filter((step) => String(field(step, "uses")).startsWith("oven-sh/setup-bun@"));
    });
    expect(setups.length).toBe(2);
    for (const setup of setups)
      expect(field(setup, "with")).toEqual({ "bun-version-file": "package.json" });
  });

  test("pins every action by SHA", async () => {
    const workflows = await renderWorkflows();
    for (const name of workflowNames) {
      const lines = (workflows[name] ?? "").split("\n").filter((line) => line.includes("uses:"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(shaPinnedUses);
    }
  });

  test("calls package scripts with --if-present", async () => {
    const ci = (await renderWorkflows())["ci"] ?? "";
    const scriptRuns = ci.split("\n").filter((line) => /run: bun run /.test(line));
    expect(scriptRuns.length).toBeGreaterThan(0);
    for (const line of scriptRuns) expect(line).toContain("bun run --if-present ");
  });
});
