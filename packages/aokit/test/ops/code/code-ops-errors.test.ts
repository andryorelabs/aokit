import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  Vfs,
  buildPlan,
} from "../../../src/engine/index.ts";
import { CodeOpError } from "../../../src/ops/code/errors.ts";
import { codeOpHandlers } from "../../../src/ops/code/index.ts";
import { fixtureManifest } from "../../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const providersSource = "export const providers = [];\n";

function moduleOf(
  manifest: Record<string, unknown>,
  sources: Record<string, string>,
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile: (from) => sources[from] ?? "",
  };
}

function declaring(
  files: { from: string; to: string }[],
  sources: Record<string, string>,
  anchor = "providers",
  kind = "array",
): EngineModule {
  return moduleOf(
    {
      name: "base",
      files: files.map((file) => ({ ...file, target: "web" })),
      extensionPoints: [{ name: "web.providers", version: "1.0.0", target: "web", kind, anchor }],
    },
    sources,
  );
}

function contributing(ops: unknown[]): EngineModule {
  return moduleOf({ name: "auth", ops }, {});
}

const addToProviders = (target = "web") => ({
  op: "addToArray",
  target,
  extensionPoint: "web.providers",
  range: "^1",
  element: "Auth()",
});

const registerAtProviders = (extra: { key?: string }) => ({
  op: "registerAt",
  target: "web",
  extensionPoint: "web.providers",
  range: "^1",
  expression: "x",
  ...extra,
});

async function failure(
  modules: EngineModule[],
  base?: Vfs,
): Promise<{ code: unknown; message: string }> {
  const error = await buildPlan({
    modules,
    layout: "single",
    answers: {},
    context,
    ...(base ? { base } : {}),
  }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof CodeOpError)) {
    throw new Error("expected a CodeOpError");
  }
  return { code: error.code, message: error.message };
}

type OpContext = Parameters<(typeof codeOpHandlers)[string]>[0];

async function captureContext(): Promise<OpContext> {
  let captured: OpContext | undefined;
  await buildPlan({
    modules: [moduleOf({ name: "demo", ops: [{ op: "addEnv", target: "web", entries: {} }] }, {})],
    layout: "single",
    answers: {},
    context,
    opHandlers: new Map([
      [
        "addEnv",
        (opContext) => {
          captured = opContext;
        },
      ],
    ]),
  });
  if (!captured) throw new Error("expected the handler to run");
  return captured;
}

test("each code handler ignores an Op that is not its own", async () => {
  const [addToArray, registerAt, addImport] = parseManifest({
    name: "auth",
    version: "1.0.0",
    description: "Fixture Module.",
    ops: [
      addToProviders(),
      registerAtProviders({}),
      {
        op: "addImport",
        target: "web",
        extensionPoint: "web.providers",
        range: "^1",
        from: "auth",
        named: ["Auth"],
      },
    ],
  }).ops;
  if (!addToArray || !registerAt || !addImport) {
    throw new Error("expected three Ops");
  }
  const ctx = await captureContext();
  expect(codeOpHandlers.addImport?.(ctx, addToArray)).toBeUndefined();
  expect(codeOpHandlers.addToArray?.(ctx, registerAt)).toBeUndefined();
  expect(codeOpHandlers.registerAt?.(ctx, addImport)).toBeUndefined();
});

test("registerAt without a key on an object Extension point is an invalid Op", async () => {
  const error = await failure([
    declaring(
      [{ from: "providers.ts", to: "providers.ts" }],
      { "providers.ts": "export const providers = {};\n" },
      "providers",
      "object",
    ),
    contributing([registerAtProviders({})]),
  ]);
  expect(error.code).toBe("ops.invalid-op");
  expect(error.message).toContain("needs a key");
});

test("registerAt with a key on an import-list Extension point is an invalid Op", async () => {
  const error = await failure([
    declaring(
      [{ from: "providers.ts", to: "providers.ts" }],
      { "providers.ts": providersSource },
      "providers",
      "import-list",
    ),
    contributing([registerAtProviders({ key: "k" })]),
  ]);
  expect(error.code).toBe("ops.invalid-op");
  expect(error.message).toContain("must not set a key");
});

test("an Op that names another Target than the Extension point lives on fails", async () => {
  const error = await failure([
    declaring([{ from: "providers.ts", to: "providers.ts" }], { "providers.ts": providersSource }),
    contributing([addToProviders("server")]),
  ]);
  expect(error.code).toBe("ops.extension-point-target");
  expect(error.message).toContain('"server"');
});

test("an anchor that is not an array literal fails naming the file", async () => {
  const error = await failure([
    declaring([{ from: "providers.ts", to: "providers.ts" }], {
      "providers.ts": "export const providers = build();\n",
    }),
    contributing([addToProviders()]),
  ]);
  expect(error.code).toBe("ops.extension-point-kind");
  expect(error.message).toContain("an array literal");
});

test("an Extension point with no matching file fails", async () => {
  const error = await failure([declaring([], {}), contributing([addToProviders()])]);
  expect(error.code).toBe("ops.anchor-file");
  expect(error.message).toContain("no file");
});

test("an Extension point whose anchor appears in two files fails naming both", async () => {
  const error = await failure([
    declaring(
      [
        { from: "providers.ts", to: "a.ts" },
        { from: "providers.ts", to: "b.ts" },
      ],
      { "providers.ts": providersSource },
    ),
    contributing([addToProviders()]),
  ]);
  expect(error.code).toBe("ops.anchor-file");
  expect(error.message).toContain("a.ts, b.ts");
});

test("anchor lookup skips unparseable and binary files", async () => {
  const base = Vfs.empty();
  base.write("broken.ts", "export const = [");
  base.write("binary.ts", new Uint8Array([0, 1, 2]));
  const plan = await buildPlan({
    modules: [
      declaring([{ from: "providers.ts", to: "providers.ts" }], {
        "providers.ts": providersSource,
      }),
      contributing([addToProviders()]),
    ],
    layout: "single",
    answers: {},
    context,
    base,
  });
  expect(plan.vfs.read("providers.ts")).toBe("export const providers = [Auth()];\n");
});
