import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineModule, Vfs } from "../../src/engine/index.ts";
import { buildProject, type PipelineInput } from "../../src/pipeline/index.ts";
import oxc from "../../../../registry-src/oxc/module.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");
const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.0.json"), "utf8")),
);

const curated: EngineModule = {
  manifest: parseManifest(oxc),
  readFile: (from) => readFileSync(join(sourceRoot, "oxc", from), "utf8"),
};

function input(layout: "single" | "monorepo"): PipelineInput {
  return {
    selection: ["oxc"],
    available: [curated],
    answers: {},
    layout,
    catalog,
    context: { now: new Date(0), random: () => 0.5, env: {} },
    registry: {
      name: "fixture",
      source: "https://registry.example/fixture",
      release: "2026.11.0",
      minCliVersion: "0.0.0",
    },
  };
}

function parsed(vfs: Vfs, path: string): unknown {
  return JSON.parse(String(vfs.read(path)));
}

describe("oxc", () => {
  test("single writes both configs at the root with pinned deps and scripts", async () => {
    const built = await buildProject(input("single"));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([
      ".oxfmtrc.json",
      ".oxlintrc.json",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
    ]);
    expect(parsed(built.plan.vfs, "package.json")).toMatchObject({
      scripts: { format: "oxfmt", lint: "oxlint -c ./.oxlintrc.json" },
      devDependencies: { oxfmt: "0.75.0", oxlint: "1.90.0" },
    });
    expect(built.lockfile.deps["oxlint"]).toMatchObject({ pinned: true });
    expect(built.lockfile.deps["oxfmt"]).toMatchObject({ pinned: true });
  });

  test("monorepo keeps the Oxfmt config at the root so it governs every package", async () => {
    const built = await buildProject(input("monorepo"));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([
      ".oxfmtrc.json",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "packages/config/.oxlintrc.json",
    ]);
  });

  test("declares lint.ignores as a json point and conflicts with eslint-prettier", () => {
    expect(curated.manifest.conflicts).toEqual(["eslint-prettier"]);
    expect(curated.manifest.extensionPoints).toEqual([
      {
        name: "lint.ignores",
        version: "1.0.0",
        target: "config",
        kind: "json",
        anchor: "/ignorePatterns",
        file: ".oxlintrc.json",
      },
    ]);
  });
});
