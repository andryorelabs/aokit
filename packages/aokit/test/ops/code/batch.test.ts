import { expect, test } from "bun:test";
import {
  type EngineContext,
  type EngineModule,
  type OpHandler,
  buildPlan,
} from "../../../src/engine/index.ts";
import { EditError } from "../../../src/edit/errors.ts";
import { codeOpHandlers } from "../../../src/ops/code/index.ts";
import { fixtureManifest } from "../../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const source = `import { Theme } from "./theme";

export const providers = [
  Theme(), // first
];

export const routes = [
  Home() // last
];

export const plugins = [];

export const handlers = {};
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

const base = moduleOf(
  {
    name: "base",
    files: [{ from: "app.ts", to: "app.ts", target: "web" }],
    extensionPoints: ["providers", "routes", "plugins", "handlers"].map((name) => ({
      name: `web.${name}`,
      version: "1.0.0",
      target: "web",
      kind: name === "handlers" ? "object" : name === "plugins" ? "import-list" : "array",
      anchor: name,
    })),
  },
  { "app.ts": source },
);

const at = (name: string) => ({ target: "web", extensionPoint: `web.${name}`, range: "^1" });

function contributor(name: string, ops: unknown[]): EngineModule {
  return moduleOf({ name, ops });
}

async function build(modules: EngineModule[], opHandlers?: ReadonlyMap<string, OpHandler>) {
  const plan = await buildPlan({
    modules: [base, ...modules],
    layout: "single",
    answers: {},
    context,
    ...(opHandlers === undefined ? {} : { opHandlers }),
  });
  return { plan, text: String(plan.vfs.read("app.ts")) };
}

test("two Modules appending to an empty inline anchor stay separated and ordered", async () => {
  const { text } = await build([
    contributor("auth", [{ op: "registerAt", ...at("plugins"), expression: "authPlugin()" }]),
    contributor("db", [{ op: "registerAt", ...at("plugins"), expression: "dbPlugin()" }]),
  ]);
  expect(text).toContain("export const plugins = [authPlugin(), dbPlugin()];");
});

test("two Modules appending to an empty inline object stay separated and ordered", async () => {
  const { text } = await build([
    contributor("auth", [{ op: "registerAt", ...at("handlers"), key: "a", expression: "one" }]),
    contributor("db", [{ op: "registerAt", ...at("handlers"), key: "b", expression: "two" }]),
  ]);
  expect(text).toContain("export const handlers = { a: one , b: two };");
});

test("two Modules appending after a last entry with a line comment keep a comma between", async () => {
  const { text } = await build([
    contributor("auth", [{ op: "addToArray", ...at("routes"), element: "Auth()" }]),
    contributor("db", [{ op: "addToArray", ...at("routes"), element: "Db()" }]),
  ]);
  expect(text).toContain("  Home(), // last\n  Auth(),\n  Db()\n];");
});

test("two Modules appending to a multiline anchor follow the canonical order", async () => {
  const { text } = await build([
    contributor("auth", [{ op: "addToArray", ...at("providers"), element: "Auth()" }]),
    contributor("db", [{ op: "addToArray", ...at("providers"), element: "Db()" }]),
  ]);
  expect(text).toContain("  Theme(), // first\n  Auth(),\n  Db(),\n];");
});

const ops = (named: string) => [
  { op: "addImport", ...at("providers"), from: "shared", named: [named, "Common"] },
  { op: "addToArray", ...at("providers"), element: "Shared()" },
];

test("duplicate checks see entries and imports queued by an earlier Module", async () => {
  const { text } = await build([contributor("auth", ops("A")), contributor("db", ops("B"))]);
  expect(text.match(/Shared\(\)/g)).toHaveLength(1);
  expect(text.match(/Common/g)).toHaveLength(1);
  expect(text).toContain('import { A, Common } from "shared";');
  expect(text).toContain('import { B } from "shared";');
});

const replacer: OpHandler = (opContext) => {
  const start = source.indexOf("Theme") + (opContext.module === "auth" ? 0 : 2);
  opContext.edits
    .batchFor("app.ts", opContext.module)
    .replace(opContext.module, start, start + 5, "X");
};

test("provenance names every contributing Module", async () => {
  const { plan } = await build([
    contributor("auth", [{ op: "addToArray", ...at("providers"), element: "Auth()" }]),
    contributor("db", [{ op: "addToArray", ...at("providers"), element: "Db()" }]),
  ]);
  const provenance = plan.changes.find((change) => change.path === "app.ts")?.provenance ?? [];
  expect(provenance.map((entry) => entry.module)).toEqual(["base", "auth", "db"]);
});

test("a data step that reads the file sees the code edits queued before it", async () => {
  const seen: string[] = [];
  const probe: OpHandler = (opContext) => {
    seen.push(String(opContext.vfs.read("app.ts")));
    opContext.vfs.write("app.ts", `${String(opContext.vfs.read("app.ts"))}// probe\n`);
  };
  const handlers = new Map<string, OpHandler>([
    ...Object.entries(codeOpHandlers),
    ["mergeJson", probe],
  ]);
  const withProbe = [
    contributor("auth", [{ op: "addToArray", ...at("providers"), element: "Auth()" }]),
    contributor("probe", [{ op: "mergeJson", target: "web", file: "app.ts", value: {} }]),
    contributor("db", [{ op: "addToArray", ...at("providers"), element: "Db()" }]),
  ];
  const { text } = await build(withProbe, handlers);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain("Auth(),");
  expect(seen[0]).not.toContain("Db()");
  expect(text).toContain("Auth(),\n  Db(),\n];");
  expect(text.endsWith("// probe\n")).toBe(true);
});

test("overlapping edits of two Modules fail with edit.overlap naming both", async () => {
  const run = build(
    [
      contributor("auth", [{ op: "addToArray", ...at("providers"), element: "A()" }]),
      contributor("db", [{ op: "addToArray", ...at("providers"), element: "B()" }]),
    ],
    new Map([["addToArray", replacer]]),
  );
  const error = await run.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(EditError);
  expect(error instanceof EditError && error.code).toBe("edit.overlap");
  expect(error instanceof EditError && error.modules).toEqual(["auth", "db"]);
});

test("an overridden Op keeps its own batch and never joins the shared one", async () => {
  const { text } = await build([
    contributor("auth", [{ op: "addToArray", ...at("providers"), element: "Auth()" }]),
    moduleOf({
      name: "custom",
      ops: [{ op: "addToArray", ...at("providers"), element: "Custom()" }],
      override: [{ op: "addToArray:web:web.providers", reason: "replace" }],
    }),
  ]);
  expect(text).toContain("Custom()");
  expect(text).not.toContain("Auth()");
});
