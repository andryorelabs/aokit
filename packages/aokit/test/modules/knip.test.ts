import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import { z } from "zod";
import type { EngineModule } from "../../src/engine/index.ts";
import { Vfs } from "../../src/engine/index.ts";
import { type PipelineInput, buildProject } from "../../src/pipeline/index.ts";
import knip from "../../../../registry-src/knip/module.ts";
import oxc from "../../../../registry-src/oxc/module.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");
const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.0.json"), "utf8")),
);

function curated(name: string, declared: object): EngineModule {
  return {
    manifest: parseManifest(declared),
    readFile: (from) => readFileSync(join(sourceRoot, name, from), "utf8"),
  };
}

const ignoresBase: EngineModule = {
  manifest: parseManifest({
    name: "ignores-base",
    version: "1.0.0",
    files: [{ from: "ignores.json", to: ".oxlintrc.json", target: "config" }],
    extensionPoints: [
      {
        name: "lint.ignores",
        version: "1.0.0",
        target: "config",
        kind: "json",
        anchor: "/ignorePatterns",
        file: ".oxlintrc.json",
      },
    ],
  }),
  readFile: () => '{ "ignorePatterns": [] }\n',
};

function input(
  layout: "single" | "monorepo",
  selection: string[],
  available: EngineModule[],
): PipelineInput {
  return {
    selection,
    available,
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

const ignoreConfigSchema = z.object({ ignorePatterns: z.array(z.string()) });

function parsed(vfs: Vfs, path: string): unknown {
  return JSON.parse(String(vfs.read(path)));
}

describe("knip", () => {
  test("alone on a minimal base writes knip.json, the script and the ignore patterns", async () => {
    const built = await buildProject(
      input("single", ["knip", "ignores-base"], [curated("knip", knip), ignoresBase]),
    );
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([".oxlintrc.json", "knip.json", "package.json"]);
    expect(parsed(built.plan.vfs, "package.json")).toMatchObject({
      scripts: { knip: "knip" },
      devDependencies: { knip: "^6.44.1" },
    });
    expect(parsed(built.plan.vfs, ".oxlintrc.json")).toEqual({
      ignorePatterns: ["knip-report/**"],
    });
  });

  test.each([
    ["single", ".oxlintrc.json"],
    ["monorepo", "packages/config/.oxlintrc.json"],
  ] as const)("oxc + knip lists the knip patterns once (%s)", async (layout, oxlintrc) => {
    const built = await buildProject(
      input(layout, ["oxc", "knip"], [curated("oxc", oxc), curated("knip", knip)]),
    );
    if (!built.ok) throw new Error(built.error.message);
    const config = ignoreConfigSchema.parse(parsed(built.plan.vfs, oxlintrc));
    expect(config.ignorePatterns.filter((pattern) => pattern === "knip-report/**")).toEqual([
      "knip-report/**",
    ]);
    expect(config.ignorePatterns).toContain("dist/**");
  });

  test("selecting knip without a declaring Module fails resolution", async () => {
    const built = await buildProject(input("single", ["knip"], [curated("knip", knip)]));
    expect(built.ok).toBe(false);
  });
});
