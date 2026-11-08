import { describe, expect, test } from "bun:test";
import { buildSelection } from "./support/index.ts";

const seededPaths = [
  ".editorconfig",
  ".git-blame-ignore-revs",
  ".github/CODEOWNERS",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
];

describe("repo-docs", () => {
  test.each(["single", "monorepo"] as const)(
    "writes the seed files and the agents Region (%s)",
    async (layout) => {
      const built = await buildSelection(["repo-docs"], layout);
      if (!built.ok) throw new Error(built.error.message);
      const paths = built.plan.vfs.paths();
      for (const path of seededPaths) expect(paths).toContain(path);
      expect(String(built.plan.vfs.read(".editorconfig"))).toContain("root = true");
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## repo-docs");
    },
  );
});
