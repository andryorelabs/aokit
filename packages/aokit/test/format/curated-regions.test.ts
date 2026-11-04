import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineModule } from "../../src/engine/index.ts";
import { createOxfmtFormatter } from "../../src/format/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");
const curated = ["oxc", "knip", "vite-react", "tailwind4", "hono", "docker", "coolify"] as const;
const skillPath = ".claude/skills/hono-add-route/SKILL.md";

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.2.json"), "utf8")),
);

async function loadModule(name: string): Promise<EngineModule> {
  const loaded: { default: unknown } = await import(join(sourceRoot, name, "module.ts"));
  return {
    manifest: parseManifest(loaded.default),
    readFile: (from) => readFileSync(join(sourceRoot, name, from), "utf8"),
  };
}

async function render(layout: "single" | "monorepo", formatted: boolean) {
  const available = await Promise.all(curated.map((name) => loadModule(name)));
  const result = await buildProject({
    selection: [...curated],
    available,
    answers: {},
    layout,
    catalog,
    context: { now: new Date(0), random: () => 0.5, env: {} },
    registry: {
      name: "official",
      source: "registry",
      release: "2026.11.2",
      minCliVersion: "0.1.0",
    },
    ...(formatted ? { formatter: createOxfmtFormatter({ catalog: installedCatalog() }) } : {}),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.plan.vfs;
}

function installedCatalog() {
  const manifest = JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "..", "..", "..", "node_modules", "oxfmt", "package.json"),
      "utf8",
    ),
  );
  return catalogSchema.parse({
    dependencies: { oxfmt: manifest.version, oxlint: "1.90.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  });
}

test.each(["single", "monorepo"] as const)(
  "Oxfmt leaves every curated Module Region, the core Regions and the Skill unchanged (%s)",
  async (layout) => {
    const plain = await render(layout, false);
    const formatted = await render(layout, true);
    for (const path of ["AGENTS.md", "CLAUDE.md", skillPath]) {
      expect(formatted.read(path)).toBe(plain.read(path));
    }
    const agents = String(plain.read("AGENTS.md"));
    for (const name of curated) {
      expect(agents).toContain(`<!-- aokit:begin ${name}:agents -->`);
    }
  },
);
