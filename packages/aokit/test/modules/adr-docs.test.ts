import { describe, expect, test } from "bun:test";
import { buildSelection } from "./support/index.ts";

const adrPaths = [
  ".claude/skills/adr/SKILL.md",
  "GLOSSARY.md",
  "docs/adr/0000-template.md",
  "docs/adr/README.md",
];

describe("adr-docs", () => {
  test.each(["single", "monorepo"] as const)(
    "writes the ADR index, template, glossary, skill and agents Region (%s)",
    async (layout) => {
      const built = await buildSelection(["adr-docs"], layout);
      if (!built.ok) throw new Error(built.error.message);
      const paths = built.plan.vfs.paths();
      for (const path of adrPaths) expect(paths).toContain(path);
      expect(String(built.plan.vfs.read(".claude/skills/adr/SKILL.md"))).toStartWith(
        "---\nname: adr",
      );
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## adr-docs");
    },
  );
});
