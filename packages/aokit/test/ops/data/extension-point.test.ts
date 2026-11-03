import { expect, test } from "bun:test";
import { type ModuleManifestInput, parseManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  Vfs,
  buildPlan,
} from "../../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const ignoresPoint: ModuleManifestInput["extensionPoints"] = [
  {
    name: "lint.ignores",
    version: "1.2.0",
    target: "config",
    kind: "json",
    anchor: "/ignorePatterns",
  },
];

const configPath = "packages/config/.oxlintrc.json";

function moduleOf(manifest: Partial<ModuleManifestInput> & { name: string }): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile() {
      throw new Error("no files");
    },
  };
}

function mergeIgnores(value: unknown, range = "^1"): ModuleManifestInput["ops"] {
  return parseManifest({
    name: "knip",
    version: "1.0.0",
    ops: [{ op: "mergeJson", extensionPoint: "lint.ignores", range, value }],
  }).ops;
}

async function run(
  ops: ModuleManifestInput["ops"],
  base: Record<string, string>,
  points: ModuleManifestInput["extensionPoints"] = ignoresPoint,
): Promise<Vfs> {
  const vfs = Vfs.empty();
  for (const [path, content] of Object.entries(base)) vfs.write(path, content);
  const plan = await buildPlan({
    modules: [moduleOf({ name: "oxc", extensionPoints: points }), moduleOf({ name: "knip", ops })],
    layout: "monorepo",
    answers: {},
    context,
    base: vfs,
  });
  return plan.vfs;
}

async function failure(attempt: Promise<unknown>): Promise<{ code?: unknown; message: string }> {
  const error = await attempt.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error("expected a failure");
  return { code: Reflect.get(error, "code"), message: error.message };
}

const baseFiles = { [configPath]: '{\n  "ignorePatterns": ["dist"]\n}\n' };

test("mergeJson at a json Extension point merges once and is idempotent", async () => {
  const once = await run(mergeIgnores(["coverage", "dist"]), baseFiles);
  const text = String(once.read(configPath));
  expect(JSON.parse(text)).toEqual({ ignorePatterns: ["dist", "coverage"] });
  const twice = await run(mergeIgnores(["coverage", "dist"]), { [configPath]: text });
  expect(twice.read(configPath)).toBe(text);
});

test("a missing Extension point fails naming the Module and the point", async () => {
  const error = await failure(run(mergeIgnores(["a"]), baseFiles, []));
  expect(error.code).toBe("ops.extension-point-missing");
  expect(error.message).toContain("knip");
  expect(error.message).toContain("lint.ignores");
});

test("a range mismatch names the Module, the point and the declared version", async () => {
  const error = await failure(run(mergeIgnores(["a"], "^2"), baseFiles));
  expect(error.code).toBe("ops.extension-point-range");
  expect(error.message).toContain("knip");
  expect(error.message).toContain("lint.ignores");
  expect(error.message).toContain("1.2.0");
});

test("a pointer to a missing node fails naming the Module, the point and the version", async () => {
  const error = await failure(run(mergeIgnores(["a"]), { [configPath]: "{}\n" }));
  expect(error.code).toBe("ops.json-pointer-missing");
  expect(error.message).toContain("knip");
  expect(error.message).toContain("lint.ignores");
  expect(error.message).toContain("1.2.0");
});

test("an array merge into a non-array fails naming the Module, the point and the version", async () => {
  const error = await failure(
    run(mergeIgnores(["a"]), { [configPath]: '{"ignorePatterns":"x"}\n' }),
  );
  expect(error.code).toBe("ops.json-pointer-type");
  expect(error.message).toContain("knip");
  expect(error.message).toContain("lint.ignores");
  expect(error.message).toContain("1.2.0");
});
