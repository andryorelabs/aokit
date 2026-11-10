import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import { coreOwner, renderHeader, writeAgentFiles } from "../../src/engine/agent-files.ts";
import { type EngineContext, Vfs, buildPlan } from "../../src/engine/index.ts";
import { parseRegions } from "../../src/patchers/markdown/regions.ts";
import { assembleLockfile } from "../../src/pipeline/assemble.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const registry = { name: "official", source: "x", release: "2026.11.2", minCliVersion: "0.0.0" };

test("the header lists the Layout, every Target with its monorepo path, and the commands", () => {
  const header = renderHeader("monorepo");
  expect(header).toContain("`monorepo` Layout");
  expect(header).toMatch(/\| `web`\s+\| `apps\/web`\s+\|/);
  expect(header).toMatch(/\| `db`\s+\| `packages\/db`\s+\|/);
  for (const command of ["aokit add", "aokit check", "aokit doctor", "aokit mcp init"]) {
    expect(header).toContain(`\`${command}\``);
  }
  expect(header).toContain("Do not edit inside aokit markers");
  expect(renderHeader("single")).toMatch(/\| `db`\s+\| `src\/db`\s+\|/);
});

test("writeAgentFiles puts aokit:header first in AGENTS.md and @AGENTS.md in CLAUDE.md", () => {
  const vfs = Vfs.empty();
  writeAgentFiles(vfs, "single");
  expect(parseRegions(String(vfs.read("AGENTS.md"))).map((span) => span.id)).toEqual([
    "aokit:header",
  ]);
  const claude = parseRegions(String(vfs.read("CLAUDE.md")));
  expect(claude.map((span) => [span.id, span.body])).toEqual([["aokit:claude", "\n@AGENTS.md"]]);
});

test("buildPlan records Provenance aokit and the Lockfile owner aokit, managed", async () => {
  const plan = await buildPlan({
    modules: [
      {
        manifest: parseManifest({ name: "solo", version: "1.0.0", description: "Fixture Module." }),
        readFile: () => "",
      },
    ],
    layout: "single",
    answers: {},
    context,
  });
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    const change = plan.changes.find((candidate) => candidate.path === path);
    expect(change?.provenance.map((entry) => entry.module)).toContain(coreOwner);
  }
  const lockfile = assembleLockfile({ plan, modules: [], layout: "single", registry, deps: {} });
  expect(lockfile.files["AGENTS.md"]).toMatchObject({ owners: ["aokit"], mode: "managed" });
  expect(lockfile.files["CLAUDE.md"]).toMatchObject({ owners: ["aokit"], mode: "managed" });
});

test("the Lockfile hash of AGENTS.md covers only its Regions", async () => {
  const plan = await buildPlan({ modules: [], layout: "single", answers: {}, context });
  const before = assembleLockfile({ plan, modules: [], layout: "single", registry, deps: {} });
  const noted = Vfs.empty();
  noted.write("AGENTS.md", `${String(plan.vfs.read("AGENTS.md"))}\nmy notes\n`);
  noted.write("CLAUDE.md", String(plan.vfs.read("CLAUDE.md")));
  const after = assembleLockfile({
    plan: { ...plan, vfs: noted },
    modules: [],
    layout: "single",
    registry,
    deps: {},
    previousFiles: before.files,
  });
  expect(after.files["AGENTS.md"]?.hash).toBe(before.files["AGENTS.md"]?.hash);
});
