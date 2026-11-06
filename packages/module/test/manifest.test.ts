import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  catalogSchema,
  compileModule,
  manifestJsonSchemaText,
  opSchema,
  parseManifest,
} from "@aokit/module";
import oxcModule from "./fixtures/oxc.module";

const oxcWorkedExample = {
  $schema: "https://aokit.andryore.dev/schema/module/v1.json",
  schemaVersion: 1,
  name: "oxc",
  version: "1.0.0",
  provides: [
    { capability: "lint", cardinality: { max: 1 } },
    { capability: "format", cardinality: { max: 1 } },
  ],
  requires: [],
  conflicts: ["eslint-prettier"],
  files: [
    {
      from: "files/oxlintrc.json",
      to: ".oxlintrc.json",
      target: "config",
      ownership: "managed",
    },
    {
      from: "files/oxfmtrc.json",
      to: ".oxfmtrc.json",
      target: "config",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      oxlint: { range: "catalog", pinGroup: "oxc" },
      oxfmt: { range: "catalog", pinGroup: "oxc" },
    },
  },
  env: [],
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { lint: "oxlint", format: "oxfmt" } },
    },
  ],
  extensionPoints: [
    {
      name: "lint.ignores",
      version: "1.0.0",
      target: "config",
      kind: "array",
      anchor: "ignorePatterns",
    },
  ],
};

test("the module-contract worked example (oxc) validates", () => {
  expect(parseManifest(oxcWorkedExample).name).toBe("oxc");
});

test("an unknown field is an error naming the field", () => {
  expect(() => parseManifest({ ...oxcWorkedExample, colour: "red" })).toThrow(/colour/);
});

test("a newer schemaVersion asks the user to update the CLI", () => {
  expect(() => parseManifest({ ...oxcWorkedExample, schemaVersion: 2 })).toThrow(/update the cli/i);
});

test("bare-string provides normalizes to { max: 1 } and many is accepted", () => {
  const manifest = parseManifest({
    name: "docker",
    version: "1.0.0",
    provides: ["orm", { capability: "deploy", cardinality: "many" }],
  });
  expect(manifest.provides).toEqual([
    { capability: "orm", cardinality: { max: 1 } },
    { capability: "deploy", cardinality: "many" },
  ]);
});

function parseObject(json: string): object {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected a JSON object");
  return parsed;
}

function opName(member: z.ZodObject): string {
  const field: unknown = member.shape.op;
  if (!(field instanceof z.ZodLiteral)) throw new Error("expected a literal op field");
  return String(field.value);
}

test("the Op union covers all 9 Ops", () => {
  const members: readonly z.ZodObject[] = opSchema.options.flatMap(
    (option): readonly z.ZodObject[] => ("options" in option ? option.options : [option]),
  );
  expect([...new Set(members.map((member) => opName(member)))].toSorted()).toEqual([
    "addCssAtRule",
    "addCssVariables",
    "addEnv",
    "addImport",
    "addToArray",
    "appendRegion",
    "mergeJson",
    "mergeYaml",
    "registerAt",
  ]);
});

test("code Ops require the Extension point and its range", () => {
  const base = { op: "addToArray", target: "web", element: "x" };
  expect(opSchema.safeParse(base).success).toBe(false);
  expect(
    opSchema.safeParse({ ...base, extensionPoint: "web.providers", range: "^1" }).success,
  ).toBe(true);
  expect(
    opSchema.safeParse({
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "x",
    }).success,
  ).toBe(false);
});

test("Ops must name a known target", () => {
  expect(opSchema.safeParse({ op: "addEnv", target: "nowhere", entries: { A: "1" } }).success).toBe(
    false,
  );
});

test("compileModule sorts keys and is byte-stable", async () => {
  const sourcePath = join(import.meta.dir, "fixtures", "oxc.module.ts");
  const first = await compileModule(sourcePath);
  const second = await compileModule(sourcePath);
  expect(first.json).toBe(second.json);
  const topLevelKeys = Object.keys(parseObject(first.json));
  expect(topLevelKeys).toEqual(topLevelKeys.toSorted());
  expect(first.json.endsWith("\n")).toBe(true);
});

test("compileModule writes module.json when asked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-module-"));
  try {
    const outFile = join(directory, "out", "module.json");
    const result = await compileModule(join(import.meta.dir, "fixtures", "oxc.module.ts"), {
      outFile,
    });
    expect(await readFile(outFile, "utf8")).toBe(result.json);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Catalog schema accepts pin groups and rejects unknown members", () => {
  expect(
    catalogSchema.safeParse({
      dependencies: { oxlint: "1.0.0", oxfmt: "1.0.0" },
      pinGroups: { oxc: ["oxlint", "oxfmt"] },
    }).success,
  ).toBe(true);
  expect(
    catalogSchema.safeParse({ dependencies: {}, pinGroups: { oxc: ["oxlint"] } }).success,
  ).toBe(false);
});

test("schema/module/v1.json matches the generated schema", async () => {
  const committed = await readFile(
    join(import.meta.dir, "..", "..", "..", "schema", "module", "v1.json"),
    "utf8",
  );
  expect(committed).toBe(manifestJsonSchemaText());
});

test("compiling the declared Module equals compiling it from its path", async () => {
  const fromObject = await compileModule(oxcModule);
  const fromPath = await compileModule(join(import.meta.dir, "fixtures", "oxc.module.ts"));
  expect(fromObject.json).toBe(fromPath.json);
});
