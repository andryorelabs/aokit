import { expect, test } from "bun:test";
import { type ModuleManifestInput, parseManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  type Formatter,
  Vfs,
  buildPlan,
} from "../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(
  manifest: Partial<ModuleManifestInput> & { name: string },
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile: (from) => sources[from] ?? "",
  };
}

test("buildPlan alone applies manifest deps and env and reports dep owners", async () => {
  const plan = await buildPlan({
    modules: [
      moduleOf({
        name: "one",
        deps: { dependencies: { zod: { range: "^4.0.0" } } },
        env: [{ key: "ONE_URL", scope: "root", example: "http://localhost" }],
      }),
      moduleOf({ name: "two", deps: { dependencies: { zod: { range: "^4.0.0" } } } }),
    ],
    layout: "single",
    answers: {},
    context,
  });
  expect(String(plan.vfs.read("package.json"))).toContain('"zod": "^4.0.0"');
  expect(String(plan.vfs.read(".env"))).toContain("ONE_URL");
  expect(plan.deps["zod"]).toEqual({
    version: "^4.0.0",
    pinned: false,
    source: "module",
    owners: ["one", "two"],
  });
});

test("the formatter only runs on files this build wrote, never on files from base", async () => {
  const shout: Formatter = {
    name: "shout",
    format(vfs) {
      const next = vfs.clone();
      for (const path of vfs.paths()) {
        const content = vfs.read(path);
        if (typeof content === "string") {
          next.write(path, content.toUpperCase());
        }
      }
      return next;
    },
  };
  const base = Vfs.empty();
  base.write("user.txt", "keep me");
  const plan = await buildPlan({
    modules: [
      moduleOf({ name: "m", files: [{ from: "a", to: "m.txt", target: "root" }] }, { a: "made" }),
    ],
    layout: "single",
    answers: {},
    context,
    base,
    formatter: shout,
  });
  expect(plan.vfs.read("user.txt")).toBe("keep me");
  expect(plan.vfs.read("m.txt")).toBe("MADE");
});
