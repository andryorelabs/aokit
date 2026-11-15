import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSelection } from "./support/index.ts";

const adrPaths = [
  ".claude/skills/add-adr/SKILL.md",
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
      expect(String(built.plan.vfs.read(".claude/skills/add-adr/SKILL.md"))).toStartWith(
        "---\nname: add-adr",
      );
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## adr-docs");
    },
  );
});

describe("adr-docs rename from 1.0.x", () => {
  const moduleDirectory = join(import.meta.dir, "..", "..", "..", "..", "registry-src", "adr-docs");

  test("renames the old skill path through renames.json", () => {
    const renames: unknown = JSON.parse(
      readFileSync(join(moduleDirectory, "renames.json"), "utf8"),
    );
    expect(renames).toEqual({ ".claude/skills/adr/SKILL.md": ".claude/skills/add-adr/SKILL.md" });
  });

  test("ships no migration that could delete an edited skill", () => {
    expect(existsSync(join(moduleDirectory, "migrations"))).toBe(false);
  });
});
