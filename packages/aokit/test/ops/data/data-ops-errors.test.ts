import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  Vfs,
  buildPlan,
} from "../../../src/engine/index.ts";
import { dataOpHandlers } from "../../../src/ops/data/index.ts";
import { fixtureManifest } from "../../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(manifest: Record<string, unknown>): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile() {
      throw new Error("no files");
    },
  };
}

function point(kind: string, file?: string, anchor = kind === "json" ? "/value" : "slot") {
  return {
    name: "demo.point",
    version: "1.0.0",
    target: "web",
    kind,
    anchor,
    ...(file === undefined ? {} : { file }),
  };
}

function throughPoint(op: Record<string, unknown>) {
  return { ...op, extensionPoint: "demo.point", range: "^1" };
}

async function failure(
  extensionPoint: Record<string, unknown>,
  op: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<{ code: unknown; message: string }> {
  const base = Vfs.empty();
  for (const [path, content] of Object.entries(files)) base.write(path, content);
  const error = await buildPlan({
    modules: [
      moduleOf({ name: "base", extensionPoints: [extensionPoint] }),
      moduleOf({ name: "demo", ops: [throughPoint(op)] }),
    ],
    layout: "single",
    answers: {},
    context,
    base,
  }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error("expected a failure");
  return { code: Reflect.get(error, "code"), message: error.message };
}

type OpContext = Parameters<(typeof dataOpHandlers)[string]>[0];

async function captureContext(): Promise<OpContext> {
  let captured: OpContext | undefined;
  await buildPlan({
    modules: [moduleOf({ name: "demo", ops: [{ op: "addEnv", target: "web", entries: {} }] })],
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

const sampleOps = parseManifest({
  name: "demo",
  version: "1.0.0",
  description: "Fixture Module.",
  ops: [
    { op: "mergeJson", target: "web", file: "a.json", value: {} },
    { op: "mergeYaml", target: "web", file: "a.yml", value: {} },
    { op: "addEnv", target: "web", entries: {} },
    { op: "addCssAtRule", target: "web", file: "a.css", rule: "import", params: '"x"' },
    { op: "addCssVariables", target: "web", file: "a.css", group: "theme", variables: {} },
    { op: "appendRegion", target: "web", file: "a.md", region: "r", content: "c" },
  ],
}).ops;

test.each(["mergeJson", "mergeYaml", "addEnv", "addCssAtRule", "addCssVariables", "appendRegion"])(
  "the %s handler refuses an Op of another kind naming the Module",
  async (name) => {
    const other = sampleOps.find((candidate) => candidate.op !== name);
    const handler = dataOpHandlers[name];
    if (!other || !handler) throw new Error("expected a sample Op and a handler");
    const opContext = await captureContext();
    expect(() => handler(opContext, other)).toThrow(
      `Handler for "${name}" received "${other.op}" in Module "demo".`,
    );
  },
);

test("an Op that needs a file fails when the Extension point declares none", async () => {
  const error = await failure(point("array"), {
    op: "addCssAtRule",
    rule: "import",
    params: '"x"',
  });
  expect(error.code).toBe("ops.extension-point-file");
  expect(error.message).toContain("lists no file");
});

test("an Op fails when the declared file is not a type it edits", async () => {
  const error = await failure(
    point("region", "notes.md"),
    { op: "addCssAtRule", rule: "import", params: '"x"' },
    { "notes.md": "text\n" },
  );
  expect(error.code).toBe("ops.extension-point-file");
  expect(error.message).toContain('"notes.md" is not a file type that Op edits');
});

test("mergeJson fails on a non-json Extension point", async () => {
  const error = await failure(
    point("region", "a.json"),
    { op: "mergeJson", value: { a: 1 } },
    { "a.json": "{}\n" },
  );
  expect(error.code).toBe("ops.extension-point-kind");
  expect(error.message).toContain("mergeJson needs a json extension point");
});

test("another data Op fails on a json Extension point", async () => {
  const error = await failure(
    point("json", "a.json"),
    { op: "mergeYaml", value: { a: 1 } },
    { "a.json": "{}\n" },
  );
  expect(error.code).toBe("ops.extension-point-kind");
  expect(error.message).toContain("json extension points are addressed with mergeJson");
});

test("mergeJson at a json Extension point fails on an empty file", async () => {
  const error = await failure(
    point("json", "a.json"),
    { op: "mergeJson", value: { a: 1 } },
    { "a.json": "" },
  );
  expect(error.code).toBe("ops.json-pointer-missing");
});

test("mergeJson at a nested json Extension point anchor merges only that node", async () => {
  const base = Vfs.empty();
  base.write("a.json", '{"outer":{"inner":{"keep":1}},"other":true}\n');
  const plan = await buildPlan({
    modules: [
      moduleOf({ name: "base", extensionPoints: [point("json", "a.json", "/outer/inner")] }),
      moduleOf({ name: "demo", ops: [throughPoint({ op: "mergeJson", value: { added: 2 } })] }),
    ],
    layout: "single",
    answers: {},
    context,
    base,
  });
  expect(JSON.parse(String(plan.vfs.read("a.json")))).toEqual({
    outer: { inner: { added: 2, keep: 1 } },
    other: true,
  });
});
