import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import triggerSource from "../../../../registry-src/trigger-dev/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const trigger = parseManifest(triggerSource);

async function build(layout: "single" | "monorepo", names: readonly string[] = ["trigger-dev"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

function parseJson(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("trigger-dev", () => {
  test("single writes the config and sample task at the root", async () => {
    const vfs = await build("single");
    expect(String(vfs.read("trigger.config.ts"))).toContain("src/trigger");
    expect(String(vfs.read("src/trigger/hello-world.ts"))).toContain("hello-world");
    expect(vfs.has(".claude/skills/trigger-dev/SKILL.md")).toBe(true);
    expect(String(vfs.read(".env"))).toContain("TRIGGER_SECRET_KEY=");
    const manifest = parseJson(vfs, "package.json");
    expect(manifest.dependencies).toMatchObject({ "@trigger.dev/sdk": "^4.8.3" });
    expect(manifest.devDependencies).toMatchObject({ "trigger.dev": "^4.8.3" });
    expect(manifest.scripts?.["jobs:dev"]).toBe("bun run --cwd . trigger dev");
  });

  test("monorepo lands the files and dependencies under packages/jobs", async () => {
    const vfs = await build("monorepo");
    expect(vfs.has("packages/jobs/trigger.config.ts")).toBe(true);
    expect(vfs.has("packages/jobs/src/trigger/hello-world.ts")).toBe(true);
    expect(vfs.has("trigger.config.ts")).toBe(false);
    expect(String(vfs.read("packages/jobs/.env"))).toContain("TRIGGER_SECRET_KEY=");
    const jobs = parseJson(vfs, "packages/jobs/package.json");
    expect(jobs.dependencies).toMatchObject({ "@trigger.dev/sdk": "catalog:" });
    expect(jobs.devDependencies).toMatchObject({ "trigger.dev": "catalog:" });
    expect(parseJson(vfs, "package.json").scripts).toMatchObject({
      "jobs:dev": "bun run --cwd packages/jobs trigger dev",
    });
  });

  test.each(["single", "monorepo"] as const)(
    "routes TRIGGER_SECRET_KEY into the t3-env schema when selected (%s)",
    async (layout) => {
      const vfs = await build(layout, ["t3-env", "trigger-dev"]);
      const path = layout === "single" ? "src/env.ts" : "packages/config/src/env.ts";
      expect(String(vfs.read(path))).toContain("TRIGGER_SECRET_KEY: z.string().min(1)");
    },
  );

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin trigger-dev:agents",
    );
  });

  test("provides jobs and declares no requirements", () => {
    expect(trigger.provides.map((entry) => entry.capability)).toEqual(["jobs"]);
    expect(trigger.requires).toEqual([]);
  });
});
