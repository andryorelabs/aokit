import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import {
  EngineError,
  type EngineContext,
  type EngineModule,
  buildPlan,
  resolveTarget,
} from "../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const layouts = ["single", "monorepo"] as const;

const providersSource = `export const providers = [
  Theme(),
];
`;

function moduleOf(
  manifest: Record<string, unknown>,
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile: (from) => sources[from] ?? "",
  };
}

const base = moduleOf(
  {
    name: "base",
    files: [{ from: "providers.ts", to: "providers.ts", target: "web" }],
    extensionPoints: [
      {
        name: "web.providers",
        version: "1.2.0",
        target: "web",
        kind: "array",
        anchor: "providers",
      },
    ],
  },
  { "providers.ts": providersSource },
);

const point = { target: "web", extensionPoint: "web.providers", range: "^1" };

function adder(name: string, element: string, override: unknown[] = []): EngineModule {
  return moduleOf({ name, ops: [{ op: "addToArray", ...point, element }], override });
}

const overrideEntry = { op: "addToArray:web:web.providers", reason: "replace" };

test.each(layouts)("an op override replaces the earlier Module's Op (%s)", async (layout) => {
  const plan = await buildPlan({
    modules: [base, adder("auth", "Auth()"), adder("custom", "Custom()", [overrideEntry])],
    layout,
    answers: {},
    context,
  });
  const directory = resolveTarget(layout, "web");
  const path = directory === "" ? "providers.ts" : `${directory}/providers.ts`;
  const content = String(plan.vfs.read(path));
  expect(content).toContain("Custom()");
  expect(content).not.toContain("Auth()");
  const provenance = plan.changes.find((change) => change.path === path)?.provenance ?? [];
  expect(provenance.find((entry) => entry.module === "auth")?.overridden).toBe(true);
  expect(provenance.find((entry) => entry.module === "custom")?.overridden).toBeUndefined();
});

test("an op override wins when the overriding Module runs first", async () => {
  const plan = await buildPlan({
    modules: [base, adder("custom", "Custom()", [overrideEntry]), adder("auth", "Auth()")],
    layout: "single",
    answers: {},
    context,
  });
  const content = String(plan.vfs.read("providers.ts"));
  expect(content).toContain("Custom()");
  expect(content).not.toContain("Auth()");
});

test("two Modules overriding the same Op fail with engine.override-conflict", async () => {
  const run = buildPlan({
    modules: [base, adder("one", "One()", [overrideEntry]), adder("two", "Two()", [overrideEntry])],
    layout: "single",
    answers: {},
    context,
  });
  const error = await run.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(EngineError);
  expect(error instanceof EngineError && error.code).toBe("engine.override-conflict");
});
