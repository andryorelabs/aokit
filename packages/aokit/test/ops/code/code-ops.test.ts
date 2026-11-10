import { expect, test } from "bun:test";
import {
  type EngineContext,
  type EngineModule,
  buildPlan,
  resolveTarget,
} from "../../../src/engine/index.ts";
import { CodeOpError } from "../../../src/ops/code/errors.ts";
import { fixtureManifest } from "../../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const layouts = ["single", "monorepo"] as const;

const providersSource = `import { Theme } from "./theme";

// keep sorted
export const providers = [
  Theme(), // first
];

export const handlers = {
  health: () => "ok",
};

export const plugins = [];
`;

function moduleOf(
  manifest: Record<string, unknown>,
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile: (from) => sources[from] ?? "",
  };
}

function base(version = "1.2.0"): EngineModule {
  const point = (name: string, kind: string, anchor: string) => ({
    name,
    version,
    target: "web",
    kind,
    anchor,
  });
  return moduleOf(
    {
      name: "base",
      files: [{ from: "providers.ts", to: "providers.ts", target: "web" }],
      extensionPoints: [
        point("web.providers", "array", "providers"),
        point("web.handlers", "object", "handlers"),
        point("web.plugins", "import-list", "plugins"),
      ],
    },
    { "providers.ts": providersSource },
  );
}

function contributor(name: string, ops: unknown[]): EngineModule {
  return moduleOf({ name, ops });
}

const point = (extensionPoint: string, range = "^1") => ({
  target: "web",
  extensionPoint,
  range,
});

async function render(layout: (typeof layouts)[number], modules: EngineModule[]): Promise<string> {
  const plan = await buildPlan({ modules: [base(), ...modules], layout, answers: {}, context });
  const directory = resolveTarget(layout, "web");
  const content = plan.vfs.read(directory === "" ? "providers.ts" : `${directory}/providers.ts`);
  if (typeof content !== "string") {
    throw new Error("providers.ts missing");
  }
  return content;
}

async function failure(modules: EngineModule[]): Promise<CodeOpError> {
  try {
    await render("single", modules);
  } catch (error) {
    if (error instanceof CodeOpError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a CodeOpError");
}

test.each(layouts)("addImport adds named, default and namespace imports (%s)", async (layout) => {
  const result = await render(layout, [
    contributor("auth", [
      {
        op: "addImport",
        ...point("web.providers"),
        from: "auth",
        named: ["Auth"],
        default: "auth",
      },
      { op: "addImport", ...point("web.providers"), from: "zod", namespace: "z" },
    ]),
  ]);
  expect(result).toContain('import { Theme } from "./theme";\nimport auth, { Auth } from "auth";');
  expect(result).toContain('import * as z from "zod";');
  expect(result).toContain("// keep sorted");
});

test("addImport merges into an existing named import", async () => {
  const result = await render("single", [
    contributor("auth", [
      { op: "addImport", ...point("web.providers"), from: "./theme", named: ["Dark"] },
    ]),
  ]);
  expect(result).toContain('import { Theme, Dark } from "./theme";');
});

test.each(layouts)("addToArray appends and keeps comments (%s)", async (layout) => {
  const result = await render(layout, [
    contributor("auth", [{ op: "addToArray", ...point("web.providers"), element: "Auth()" }]),
  ]);
  expect(result).toContain("  Theme(), // first\n  Auth(),\n];");
});

test.each(layouts)("registerAt adds object keys and import-list entries (%s)", async (layout) => {
  const result = await render(layout, [
    contributor("auth", [
      { op: "registerAt", ...point("web.handlers"), key: "login", expression: "loginHandler" },
      { op: "registerAt", ...point("web.plugins"), expression: "authPlugin()" },
    ]),
  ]);
  expect(result).toContain('  health: () => "ok",\n  login: loginHandler,\n};');
  expect(result).toContain("export const plugins = [authPlugin()];");
});

test("an unsatisfied range is an error naming both Modules", async () => {
  const error = await failure([
    contributor("auth", [{ op: "addToArray", ...point("web.providers", "^2"), element: "Auth()" }]),
  ]);
  expect(error.code).toBe("ops.extension-point-range");
  expect(error.message).toContain('"auth"');
  expect(error.message).toContain('"base"');
  expect(error.message).toContain("^2");
});

test("an unknown Extension point is an error", async () => {
  const error = await failure([
    contributor("auth", [{ op: "addToArray", ...point("web.nope"), element: "x" }]),
  ]);
  expect(error.code).toBe("ops.extension-point-missing");
  expect(error.message).toContain("web.nope@");
  expect(error.message).toContain("fix: select the Module that declares");
});

test("an Op on the wrong kind is an error", async () => {
  const error = await failure([
    contributor("auth", [{ op: "addToArray", ...point("web.handlers"), element: "x" }]),
  ]);
  expect(error.code).toBe("ops.extension-point-kind");
});

test.each(layouts)("two Modules at one anchor follow canonical order (%s)", async (layout) => {
  const result = await render(layout, [
    contributor("auth", [{ op: "addToArray", ...point("web.providers"), element: "Auth()" }]),
    contributor("posthog", [{ op: "addToArray", ...point("web.providers"), element: "Posthog()" }]),
  ]);
  expect(result.indexOf("Auth()")).toBeLessThan(result.indexOf("Posthog()"));
  expect(result.indexOf("Theme()")).toBeLessThan(result.indexOf("Auth()"));
});

test.each(layouts)("applying each Op a second time changes nothing (%s)", async (layout) => {
  const ops = [
    { op: "addImport", ...point("web.providers"), from: "auth", named: ["Auth"], default: "auth" },
    { op: "addImport", ...point("web.providers"), from: "zod", namespace: "z" },
    { op: "addToArray", ...point("web.providers"), element: "Auth()" },
    { op: "registerAt", ...point("web.handlers"), key: "login", expression: "loginHandler" },
    { op: "registerAt", ...point("web.plugins"), expression: "authPlugin()" },
  ];
  const once = await render(layout, [contributor("auth", ops)]);
  const twice = await render(layout, [contributor("auth", ops), contributor("auth2", ops)]);
  expect(twice).toBe(once);
  const doubled = await render(layout, [contributor("auth", [...ops, ...ops])]);
  expect(doubled).toBe(once);
});

const register = (key: string, expression: string) => ({
  op: "registerAt",
  ...point("web.handlers"),
  key,
  expression,
});

test.each(layouts)("registerAt on a quoted key is idempotent (%s)", async (layout) => {
  const once = await render(layout, [contributor("auth", [register('"/login"', "login")])]);
  const twice = await render(layout, [
    contributor("auth", [register('"/login"', "login"), register('"/login"', "login")]),
  ]);
  expect(twice).toBe(once);
  expect(once).toContain('"/login": login');
});

test("two Modules registering one key with different values fail naming both", async () => {
  const error = await failure([
    contributor("auth", [register("ping", "authPing")]),
    contributor("billing", [register("ping", "billingPing")]),
  ]);
  expect(error.code).toBe("ops.key-conflict");
  expect(error.message).toContain('"auth"');
  expect(error.message).toContain('"billing"');
});

test("anchor lookup ignores declaration files and generated directories", async () => {
  const generated = moduleOf(
    {
      name: "generated",
      files: [
        { from: "providers.ts", to: "dist/providers.ts", target: "web" },
        { from: "providers.ts", to: "types/providers.d.ts", target: "web" },
      ],
    },
    { "providers.ts": providersSource },
  );
  const result = await render("single", [
    generated,
    contributor("auth", [{ op: "addToArray", ...point("web.providers"), element: "Auth()" }]),
  ]);
  expect(result).toContain("Auth()");
});

test("an Extension point with a declared file ignores the same anchor in other files", async () => {
  const source = "export const routes = [];\n";
  const twoSites = moduleOf(
    {
      name: "two-sites",
      files: [
        { from: "routes.ts", to: "src/routes.ts", target: "web" },
        { from: "routes.ts", to: "src/other.ts", target: "web" },
      ],
      extensionPoints: [
        {
          name: "web.routes",
          version: "1.0.0",
          target: "web",
          kind: "array",
          anchor: "routes",
          file: "src/routes.ts",
        },
      ],
    },
    { "routes.ts": source },
  );
  const plan = await buildPlan({
    modules: [
      twoSites,
      contributor("auth", [{ op: "addToArray", ...point("web.routes"), element: "Auth()" }]),
    ],
    layout: "single",
    answers: {},
    context,
  });
  expect(String(plan.vfs.read("src/routes.ts"))).toContain("Auth()");
  expect(String(plan.vfs.read("src/other.ts"))).not.toContain("Auth()");
});
