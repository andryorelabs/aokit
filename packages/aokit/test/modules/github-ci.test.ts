import { describe, expect, test } from "bun:test";
import { buildSelection } from "./support/index.ts";

const workflowNames = ["ci", "codeql", "labels", "lint-pr", "lint-workflows", "scorecard"];

const seededPaths = [
  ".github/labels.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
];

const shaPinnedUses = /^\s*- uses: [\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

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
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## github-ci");
    },
  );

  test("pins every action by SHA", async () => {
    const built = await buildSelection(["github-ci"], "single");
    if (!built.ok) throw new Error(built.error.message);
    for (const name of workflowNames) {
      const lines = String(built.plan.vfs.read(`.github/workflows/${name}.yml`))
        .split("\n")
        .filter((line) => line.includes("uses:"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(shaPinnedUses);
    }
  });

  test("calls package scripts with --if-present", async () => {
    const built = await buildSelection(["github-ci"], "single");
    if (!built.ok) throw new Error(built.error.message);
    const ci = String(built.plan.vfs.read(".github/workflows/ci.yml"));
    const scriptRuns = ci.split("\n").filter((line) => /run: bun run /.test(line));
    expect(scriptRuns.length).toBeGreaterThan(0);
    for (const line of scriptRuns) expect(line).toContain("bun run --if-present ");
  });
});
