import { describe, expect, test } from "bun:test";

import { buildSelection } from "./support/index.ts";

describe("release-skills", () => {
  test.each(["single", "monorepo"] as const)(
    "writes the cut-release and add-adr skills and the agents Region (%s)",
    async (layout) => {
      const built = await buildSelection(["release-skills", "adr-docs"], layout);
      if (!built.ok) throw new Error(built.error.message);
      const paths = built.plan.vfs.paths();
      expect(paths).toContain(".claude/skills/cut-release/SKILL.md");
      expect(paths).toContain(".claude/skills/add-adr/SKILL.md");
      expect(String(built.plan.vfs.read(".claude/skills/cut-release/SKILL.md"))).toStartWith(
        "---\nname: cut-release",
      );
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## release-skills");
    },
  );
});
