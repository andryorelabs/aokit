import { expect, test } from "bun:test";
import { type ModuleManifestInput } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  type OpHandler,
  Vfs,
  buildPlan,
  createOpRegistry,
} from "../../src/engine/index.ts";
import { fixtureManifest } from "../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(
  manifest: Partial<ModuleManifestInput> & { name: string },
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile: (from) => sources[from] ?? "",
  };
}

const writer: OpHandler = (opContext) => {
  const { vfs, module } = opContext;
  const marker = `${module}.txt`;
  vfs.write(marker, "written");
  const seen = {
    has: vfs.has(marker),
    read: vfs.read(marker),
    paths: vfs.paths().includes(marker),
    owners: opContext.modulesOf(marker),
  };
  vfs.write(`${module}-seen.json`, JSON.stringify(seen));
  opContext.edits.flush();
};

test("an Op handler sees its own writes through has, read, paths and modulesOf", async () => {
  const plan = await buildPlan({
    modules: [moduleOf({ name: "solo", ops: [{ op: "addEnv", target: "root", entries: {} }] })],
    layout: "single",
    answers: {},
    context,
    opHandlers: createOpRegistry({ addEnv: writer }),
  });
  expect(JSON.parse(String(plan.vfs.read("solo-seen.json")))).toEqual({
    has: true,
    read: "written",
    paths: true,
    owners: ["solo"],
  });
});

test("an overridden Op handler writes only to a scratch copy", async () => {
  const plan = await buildPlan({
    modules: [
      moduleOf({ name: "first", ops: [{ op: "addEnv", target: "root", entries: {} }] }),
      moduleOf({
        name: "second",
        ops: [{ op: "addEnv", target: "root", entries: {} }],
        override: [{ op: "addEnv", reason: "replace" }],
      }),
    ],
    layout: "single",
    answers: {},
    context,
    opHandlers: createOpRegistry({ addEnv: writer }),
  });
  expect(plan.vfs.has("first.txt")).toBe(false);
  expect(plan.vfs.has("first-seen.json")).toBe(false);
  expect(plan.vfs.has("second.txt")).toBe(true);
});

const probe: OpHandler = ({ vfs }) => {
  vfs.write("probe.json", JSON.stringify({ existing: vfs.read("existing.txt") ?? null }));
};

test("a base file seen by Op handlers in a monorepo layout", async () => {
  const base = Vfs.empty();
  base.write("existing.txt", "from base");
  const plan = await buildPlan({
    modules: [
      moduleOf({
        name: "web-app",
        files: [{ from: "a", to: "page.tsx", target: "web" }],
        ops: [{ op: "addEnv", target: "web", entries: {} }],
      }),
      moduleOf({ name: "api", files: [{ from: "a", to: "index.ts", target: "server" }] }),
    ],
    layout: "monorepo",
    answers: {},
    context,
    base,
    opHandlers: createOpRegistry({ addEnv: probe }),
  });
  expect(plan.vfs.has("probe.json")).toBe(true);
});
