import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModuleManifestInput } from "@aokit/module";
import {
  EngineError,
  type EngineContext,
  type EngineModule,
  type Formatter,
  type OpHandler,
  Vfs,
  buildPlan,
  createOpRegistry,
  interpolateContent,
  interpolateImports,
  interpolatePath,
  layoutTables,
  interpolateTargets,
  interpolateTargetsDeep,
  resolveTarget,
} from "../../src/engine/index.ts";
import { fixtureManifest } from "../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(
  manifest: Partial<ModuleManifestInput> & { name: string },
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile(from) {
      const source = sources[from];
      if (source === undefined) {
        throw new Error(`missing fixture ${from}`);
      }
      return source;
    },
  };
}

function capture(action: () => unknown): Promise<EngineError> {
  return Promise.resolve()
    .then(action)
    .then(
      () => {
        throw new Error("expected an EngineError");
      },
      (error: unknown) => {
        if (error instanceof EngineError) {
          return error;
        }
        throw error;
      },
    );
}

function build(modules: EngineModule[], extra: Partial<Parameters<typeof buildPlan>[0]> = {}) {
  return buildPlan({ modules, layout: "single", answers: {}, context, ...extra });
}

test("both Layout tables resolve every built-in Target", () => {
  for (const layout of ["single", "monorepo"] as const) {
    for (const target of Object.keys(layoutTables[layout])) {
      expect(typeof resolveTarget(layout, target)).toBe("string");
    }
  }
  expect(resolveTarget("single", "db")).toBe("src/db");
  expect(resolveTarget("monorepo", "shared-ui")).toBe("packages/ui");
});

test("an unresolvable Target names the Target and its Modules", async () => {
  const module = moduleOf(
    { name: "odd", files: [{ from: "a", to: "a.txt", target: "root" }] },
    { a: "x" },
  );
  const broken: EngineModule = {
    readFile: (from) => module.readFile(from),
    manifest: Object.assign({}, module.manifest, {
      files: [{ from: "a", to: "a.txt", target: "mobile" }],
    }),
  };
  const error = await capture(() => build([broken]));
  expect(error.code).toBe("engine.layout-unresolvable");
  expect(error.message).toContain('"mobile"');
  expect(error.message).toContain("odd");
});

test("files land in Layout-resolved Targets for both Layouts", async () => {
  const module = moduleOf(
    { name: "db", files: [{ from: "schema", to: "schema.ts", target: "db" }] },
    { schema: "x" },
  );
  const single = await build([module]);
  const monorepo = await build([module], { layout: "monorepo" });
  expect(single.changes.map((change) => change.path)).toEqual([
    "AGENTS.md",
    "CLAUDE.md",
    "src/db/schema.ts",
  ]);
  expect(monorepo.changes.map((change) => change.path)).toEqual([
    "AGENTS.md",
    "CLAUDE.md",
    "packages/db/schema.ts",
  ]);
});

test("interpolation replaces only {{var}} and __name__", async () => {
  expect(interpolateContent("a {{name}} {{ name }} ${name} {{other}}", { name: "x" })).toBe(
    "a x {{ name }} ${name} {{other}}",
  );
  expect(interpolatePath("__name__/__tests__/__name__.ts", { name: "app" })).toBe(
    "app/__tests__/app.ts",
  );
  const module = moduleOf(
    {
      name: "base",
      answers: { project: { type: "string", default: "demo" } },
      files: [{ from: "f", to: "__project__.txt", target: "root" }],
    },
    { f: "hello {{project}}\r\n" },
  );
  const plan = await build([module]);
  const demo = plan.changes.find((change) => change.path === "demo.txt");
  expect(demo?.content).toBe("hello demo\n");
});

test("the Plan lists create, update, delete and rename with Provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-engine-"));
  try {
    await writeFile(join(directory, "keep.txt"), "same\n");
    await writeFile(join(directory, "edit.txt"), "old\n");
    await writeFile(join(directory, "gone.txt"), "bye\n");
    await writeFile(join(directory, "moved-old.txt"), "moving\n");
    await mkdir(join(directory, "node_modules"));
    await writeFile(join(directory, "node_modules", "ignored.js"), "x");
    const base = await Vfs.fromDirectory(directory);
    expect(base.paths()).toEqual(["edit.txt", "gone.txt", "keep.txt", "moved-old.txt"]);

    const module = moduleOf(
      {
        name: "base",
        files: [
          { from: "k", to: "keep.txt", target: "root" },
          { from: "e", to: "edit.txt", target: "root" },
          { from: "m", to: "moved-new.txt", target: "root" },
          { from: "n", to: "new.txt", target: "root" },
        ],
      },
      { k: "same\n", e: "new\n", m: "moving\n", n: "fresh\n" },
    );
    const plan = await build([module], {
      base,
      removals: [
        { path: "gone.txt", module: "base" },
        { path: "moved-old.txt", module: "base" },
      ],
    });
    const summary = plan.changes.map((change) => `${change.type}:${change.path}`);
    expect(summary).toEqual([
      "create:AGENTS.md",
      "create:CLAUDE.md",
      "update:edit.txt",
      "delete:gone.txt",
      "rename:moved-new.txt",
      "create:new.txt",
    ]);
    const rename = plan.changes.find((change) => change.type === "rename");
    expect(rename?.renamedFrom).toBe("moved-old.txt");
    expect(plan.changes.find((change) => change.path === "new.txt")?.provenance).toEqual([
      { module: "base", entry: { kind: "file", from: "n" } },
    ]);
    expect(plan.changes.find((change) => change.type === "delete")?.provenance).toEqual([
      { module: "base", entry: { kind: "remove" } },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the same path from two Modules fails naming both", async () => {
  const entry = [{ from: "f", to: "a.txt", target: "root" as const }];
  const one = moduleOf({ name: "one", files: entry }, { f: "1" });
  const two = moduleOf({ name: "two", files: entry }, { f: "2" });
  const error = await capture(() => build([one, two]));
  expect(error.code).toBe("engine.path-collision");
  expect(error.modules).toEqual(["one", "two"]);
});

test("a declared override wins, in either order, and two overrides fail", async () => {
  const entry = [{ from: "f", to: "a.txt", target: "root" as const }];
  const base = moduleOf({ name: "base", files: entry }, { f: "base" });
  const custom = moduleOf(
    { name: "custom", files: entry, override: [{ file: "root:a.txt", reason: "r" }] },
    { f: "custom" },
  );
  const rival = moduleOf(
    { name: "rival", files: entry, override: [{ file: "root:a.txt", reason: "r" }] },
    { f: "rival" },
  );
  const plans = await Promise.all([build([base, custom]), build([custom, base])]);
  for (const plan of plans) {
    const overridden = plan.changes.find((change) => change.path === "a.txt");
    expect(overridden?.content).toBe("custom");
    expect(overridden?.provenance.map((p) => p.module).toSorted()).toEqual(["base", "custom"]);
  }
  const error = await capture(() => build([base, custom, rival]));
  expect(error.code).toBe("engine.override-conflict");
  expect(error.modules).toEqual(["custom", "rival"]);
});

test("ownership modes are recorded and seed files do not overwrite disk", async () => {
  const module = moduleOf(
    {
      name: "base",
      files: [
        { from: "s", to: "page.tsx", target: "root", ownership: "seed" },
        { from: "m", to: "managed.txt", target: "root" },
      ],
    },
    { s: "seed", m: "managed" },
  );
  const fresh = await build([module]);
  expect(fresh.changes.map((c) => [c.path, c.ownership])).toEqual([
    ["AGENTS.md", "managed"],
    ["CLAUDE.md", "managed"],
    ["managed.txt", "managed"],
    ["page.tsx", "seed"],
  ]);
  const base = Vfs.empty();
  base.write("page.tsx", "user edit");
  const existing = await build([module], { base });
  expect(existing.changes.map((c) => c.path)).toEqual(["AGENTS.md", "CLAUDE.md", "managed.txt"]);
});

test("a Formatter runs after all Modules and is skipped when absent", async () => {
  const seen: string[] = [];
  const formatter: Formatter = {
    name: "fake-fmt",
    format(vfs) {
      seen.push(vfs.paths().join(","));
      for (const path of vfs.paths()) {
        vfs.write(path, `${String(vfs.read(path)).trim()}\n`);
      }
      return vfs;
    },
  };
  const one = moduleOf(
    { name: "one", files: [{ from: "f", to: "a.txt", target: "root" }] },
    { f: "a  " },
  );
  const two = moduleOf(
    { name: "two", files: [{ from: "f", to: "b.txt", target: "root" }] },
    { f: "b  " },
  );
  const formatted = await build([one, two], { formatter });
  expect(seen).toEqual(["AGENTS.md,CLAUDE.md,a.txt,b.txt"]);
  const formattedA = formatted.changes.find((change) => change.path === "a.txt");
  expect(formattedA?.content).toBe("a\n");
  expect(formattedA?.provenance.map((p) => p.module)).toEqual(["one", "fake-fmt"]);
  const unformatted = await build([one, two]);
  expect(unformatted.changes.find((change) => change.path === "a.txt")?.content).toBe("a  ");
});

test("the Plan hash is stable, order-independent of emission and ignores volatile content", async () => {
  const make = (secret: string) => {
    const handler: OpHandler = ({ vfs }) => {
      vfs.write(".env", `SECRET=${secret}\n`, { volatile: true });
    };
    return {
      module: moduleOf(
        {
          name: "base",
          files: [
            { from: "b", to: "b.txt", target: "root" },
            { from: "a", to: "a.txt", target: "root" },
          ],
          ops: [{ op: "addEnv", target: "root", entries: {} }],
        },
        { a: "a\r\n", b: "b\n" },
      ),
      opHandlers: createOpRegistry({ addEnv: handler }),
    };
  };
  const first = make("one");
  const second = make("two");
  const planOne = await build([first.module], { opHandlers: first.opHandlers });
  const planTwo = await build([first.module], { opHandlers: first.opHandlers });
  const planThree = await build([second.module], { opHandlers: second.opHandlers });
  expect(planOne.hash).toBe(planTwo.hash);
  expect(planOne.hash).toBe(planThree.hash);
  expect(planOne.hash).toMatch(/^[0-9a-f]{64}$/);
  const lf = await build([
    moduleOf({ name: "x", files: [{ from: "a", to: "a.txt", target: "root" }] }, { a: "a\n" }),
  ]);
  const crlf = await build([
    moduleOf({ name: "x", files: [{ from: "a", to: "a.txt", target: "root" }] }, { a: "a\r\n" }),
  ]);
  expect(lf.hash).toBe(crlf.hash);
  const changed = await build([
    moduleOf({ name: "x", files: [{ from: "a", to: "a.txt", target: "root" }] }, { a: "b\n" }),
  ]);
  expect(changed.hash).not.toBe(lf.hash);
});

test("Op handlers receive injected context and record Provenance", async () => {
  let received: EngineContext | undefined;
  const handler: OpHandler = (opContext) => {
    const { vfs, module } = opContext;
    received = opContext.context;
    vfs.write(opContext.resolvePath("server", "marker.txt"), module);
  };
  const module = moduleOf({
    name: "hono",
    ops: [{ op: "addEnv", target: "server", entries: {} }],
  });
  const plan = await build([module], { opHandlers: createOpRegistry({ addEnv: handler }) });
  expect(received).toBe(context);
  const marker = plan.changes.find((change) => change.path === "marker.txt");
  expect(marker?.provenance).toEqual([{ module: "hono", entry: { kind: "op", op: "addEnv" } }]);
});

test("an unknown Op name fails naming the Op and the Module", async () => {
  const module = moduleOf({
    name: "hono",
    ops: [{ op: "addEnv", target: "server", entries: {} }],
  });
  const error = await capture(() => build([module], { opHandlers: createOpRegistry({}) }));
  expect(error.code).toBe("engine.unknown-op");
  expect(error.message).toContain("addEnv");
  expect(error.message).toContain("hono");
});

test("Vfs.fromDirectory loads the same paths for a trailing slash and the current directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-engine-"));
  const previous = process.cwd();
  try {
    await mkdir(join(directory, "sub"));
    await writeFile(join(directory, "top.txt"), "t\n");
    await writeFile(join(directory, "sub", "f.txt"), "f\n");
    const expected = ["sub/f.txt", "top.txt"];
    expect((await Vfs.fromDirectory(directory)).paths()).toEqual(expected);
    expect((await Vfs.fromDirectory(`${directory}/`)).paths()).toEqual(expected);
    process.chdir(directory);
    expect((await Vfs.fromDirectory(".")).paths()).toEqual(expected);
  } finally {
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("each Module only sees its own declared answers", async () => {
  const first = moduleOf(
    {
      name: "first",
      answers: { title: { type: "string", default: "one" } },
      files: [{ from: "f", to: "first.txt", target: "root" }],
    },
    { f: "{{title}}\n" },
  );
  const second = moduleOf(
    {
      name: "second",
      answers: { title: { type: "string", default: "two" } },
      files: [{ from: "f", to: "second.txt", target: "root" }],
    },
    { f: "{{title}} {{undeclared}}\n" },
  );
  const plan = await build([first, second], {
    answers: { first: { title: "x" }, other: { undeclared: "leak" } },
  });
  const content = Object.fromEntries(plan.changes.map((change) => [change.path, change.content]));
  expect(content["first.txt"]).toBe("x\n");
  expect(content["second.txt"]).toBe("two {{undeclared}}\n");
});

const singleDirectoryOf = (target: string): string => resolveTarget("single", target);

test("{{target:name}} resolves to the Layout directory, or . for the Project root", () => {
  expect(interpolateTargets("vite {{target:web}} {{target:db}}", singleDirectoryOf)).toBe(
    "vite . src/db",
  );
  expect(interpolateTargets("{{target:web}}/x", (t) => resolveTarget("monorepo", t))).toBe(
    "apps/web/x",
  );
  expect(interpolateTargetsDeep({ a: ["{{target:web}}"], b: 1 }, singleDirectoryOf)).toEqual({
    a: ["."],
    b: 1,
  });
});

function importLocation(target: string, subpath: string): string {
  return target === "root" ? subpath : `packages/ui/${subpath}`;
}

test("interpolateImports resolves a relative specifier from the importing directory", () => {
  expect(interpolateImports("from '{{import:root:x}}'", ".", importLocation)).toBe("from './x'");
  expect(interpolateImports('from "{{import:ui:ui/button}}"', "apps/web/src", importLocation)).toBe(
    'from "../../../packages/ui/ui/button"',
  );
  expect(interpolateImports("{{var}} {{target:web}}", "src", importLocation)).toBe(
    "{{var}} {{target:web}}",
  );
});

test("a {{import}} marker with an unresolvable Target fails the build", () => {
  const module = moduleOf({
    name: "bad",
    files: [{ from: "a.ts", to: "a.ts", target: "web" }],
  });
  expect(() =>
    buildPlan({
      modules: [{ ...module, readFile: () => "import x from '{{import:nowhere:x}}';" }],
      layout: "single",
      answers: {},
      context,
      base: Vfs.empty(),
    }),
  ).toThrow(EngineError);
});
