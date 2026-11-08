import { expect, test } from "bun:test";
import {
  type Catalog,
  type ModuleManifestInput,
  catalogSchema,
  parseManifest,
} from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  Vfs,
  buildPlan,
  resolveTarget,
} from "../../../src/engine/index.ts";
import type { LayoutName } from "../../../src/engine/layout.ts";
import { applyDeps } from "../../../src/ops/data/index.ts";
import { applyEnv } from "../../../src/ops/data/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(manifest: Partial<ModuleManifestInput> & { name: string }): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile() {
      throw new Error("no files");
    },
  };
}

function readJson(content: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(String(content));
  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

async function run(
  ops: ModuleManifestInput["ops"],
  base: Record<string, string> = {},
  layout: LayoutName = "single",
): Promise<Vfs> {
  const vfs = Vfs.empty();
  for (const [path, content] of Object.entries(base)) vfs.write(path, content);
  const plan = await buildPlan({
    modules: [moduleOf({ name: "demo", ops })],
    layout,
    answers: {},
    context,
    base: vfs,
  });
  return plan.vfs;
}

async function expectIdempotent(
  ops: ModuleManifestInput["ops"],
  base: Record<string, string> = {},
): Promise<Vfs> {
  const once = await run(ops, base);
  const twice = await run(
    ops,
    Object.fromEntries(once.paths().map((path) => [path, String(once.read(path))])),
  );
  expect(twice.paths()).toEqual(once.paths());
  for (const path of once.paths()) expect(twice.read(path)).toBe(once.read(path));
  return once;
}

test("mergeJson merges into the Layout-resolved file, unions arrays, keeps comments", async () => {
  const ops: ModuleManifestInput["ops"] = [
    {
      op: "mergeJson",
      target: "config",
      file: "tsconfig.json",
      value: { compilerOptions: { types: ["bun"], strict: true } },
    },
  ];
  const base = {
    "packages/config/tsconfig.json":
      '{\n  // keep\n  "compilerOptions": { "types": ["node"] }\n}\n',
  };
  const monorepo = await run(ops, base, "monorepo");
  const text = String(monorepo.read("packages/config/tsconfig.json"));
  expect(text).toContain("// keep");
  expect(text).toContain('"bun"');
  expect(text).toContain('"node"');
  expect(text).toContain('"strict": true');

  const single = await expectIdempotent(ops);
  expect(single.has("tsconfig.json")).toBe(true);
});

test("mergeYaml edits the resolved file and is idempotent", async () => {
  const ops: ModuleManifestInput["ops"] = [
    { op: "mergeYaml", target: "root", file: "ci.yml", value: { jobs: { test: { runs: "bun" } } } },
  ];
  const result = await expectIdempotent(ops, { "ci.yml": "# top\nname: ci\n" });
  const text = String(result.read("ci.yml"));
  expect(text).toContain("# top");
  expect(text).toContain("runs: bun");
});

test("addEnv defaults to .env, never overwrites and is idempotent", async () => {
  const ops: ModuleManifestInput["ops"] = [
    { op: "addEnv", target: "server", entries: { DATABASE_URL: "x", PORT: "3000" } },
  ];
  const result = await expectIdempotent(ops, { ".env": "PORT=8080\n" });
  expect(result.read(".env")).toBe("PORT=8080\nDATABASE_URL=x\n");
});

test("addCssAtRule adds header rules and @theme declarations idempotently", async () => {
  const ops: ModuleManifestInput["ops"] = [
    {
      op: "addCssAtRule",
      target: "web",
      file: "app.css",
      rule: "plugin",
      params: '"@tw/typography"',
    },
    {
      op: "addCssAtRule",
      target: "web",
      file: "app.css",
      rule: "theme",
      params: "",
      body: "--color-brand: #fff; --font-sans: Inter",
    },
  ];
  const result = await expectIdempotent(ops, { "app.css": '@import "tailwindcss";\n' });
  const text = String(result.read("app.css"));
  expect(text).toContain('@plugin "@tw/typography"');
  expect(text).toContain("--color-brand: #fff");
  expect(text).toContain("--font-sans: Inter");
});

test("appendRegion owns only its marker region and is idempotent", async () => {
  const ops: ModuleManifestInput["ops"] = [
    { op: "appendRegion", target: "root", file: "README.md", region: "scripts", content: "run it" },
  ];
  const result = await expectIdempotent(ops, { "README.md": "# Hi\n" });
  const text = String(result.read("README.md"));
  expect(text.startsWith("# Hi\n")).toBe(true);
  expect(text).toContain("run it");
  const updated = await run(
    [{ op: "appendRegion", target: "root", file: "README.md", region: "scripts", content: "new" }],
    { "README.md": text },
  );
  expect(String(updated.read("README.md"))).toContain("new");
  expect(String(updated.read("README.md"))).not.toContain("run it");
});

test("appendRegion writes comment markers that match the target file type", async () => {
  const gitignore = await run(
    [
      {
        op: "appendRegion",
        target: "root",
        file: ".gitignore",
        region: "keys",
        content: ".env.keys",
      },
    ],
    { ".gitignore": "node_modules\n" },
  );
  const gitignoreText = String(gitignore.read(".gitignore"));
  expect(gitignoreText).toContain("# aokit:begin");
  expect(gitignoreText).not.toContain("<!--");
  const prisma = await run(
    [
      {
        op: "appendRegion",
        target: "root",
        file: "schema.prisma",
        region: "models",
        content: "model A {}",
      },
    ],
    { "schema.prisma": "generator client {}\n" },
  );
  const prismaText = String(prisma.read("schema.prisma"));
  expect(prismaText).toContain("// aokit:begin");
  expect(prismaText).not.toContain("<!--");
});

const catalog: Catalog = catalogSchema.parse({
  dependencies: { next: "^16.0.0", oxlint: "^1.90.0", zod: "^4.0.0" },
  pinGroups: { oxc: ["oxlint"] },
});

function depsOptions(layout: LayoutName, target: string, vfs: Vfs) {
  return {
    vfs,
    layout,
    module: "demo",
    target,
    catalog,
    deps: {
      dependencies: { next: { range: "catalog" } },
      devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } },
    },
    resolvePath: (name: string, relative: string) =>
      `${resolveTarget(layout, name)}/${relative}`.replace(/^\//, ""),
  };
}

test("applyDeps in single writes ranges and exact pins, and records them", () => {
  const vfs = Vfs.empty();
  const recorded = applyDeps(depsOptions("single", "root", vfs));
  const pkg = readJson(vfs.read("package.json"));
  expect(pkg["dependencies"]).toEqual({ next: "^16.0.0" });
  expect(pkg["devDependencies"]).toEqual({ oxlint: "1.90.0" });
  expect(pkg["catalog"]).toBeUndefined();
  expect(recorded).toEqual({
    next: { version: "^16.0.0", pinned: false, source: "catalog" },
    oxlint: { version: "1.90.0", pinned: true, source: "catalog" },
  });
  const before = String(vfs.read("package.json"));
  applyDeps(depsOptions("single", "root", vfs));
  expect(vfs.read("package.json")).toBe(before);
});

test("applyDeps in monorepo gives workspace packages bare catalog: and the root the Catalog", () => {
  const vfs = Vfs.empty();
  vfs.write("package.json", '{ "name": "root" }\n');
  applyDeps(depsOptions("monorepo", "web", vfs));
  const web = readJson(vfs.read("apps/web/package.json"));
  expect(web["dependencies"]).toEqual({ next: "catalog:" });
  expect(web["devDependencies"]).toEqual({ oxlint: "catalog:" });
  const root = readJson(vfs.read("package.json"));
  expect(root["name"]).toBe("root");
  expect(root["catalog"]).toEqual({ next: "^16.0.0", oxlint: "1.90.0" });
  const before = String(vfs.read("package.json"));
  applyDeps(depsOptions("monorepo", "web", vfs));
  expect(vfs.read("package.json")).toBe(before);
});

test("applyDeps fails when the Catalog lacks a dependency", () => {
  expect(() =>
    applyDeps({
      ...depsOptions("single", "root", Vfs.empty()),
      deps: { dependencies: { missing: { range: "catalog" } } },
    }),
  ).toThrow(/missing/);
});

test("applyEnv adds example values to the scope .env and never overwrites", () => {
  const vfs = Vfs.empty();
  vfs.write(".env", "SECRET=mine\n");
  const options = {
    vfs,
    env: [
      { key: "SECRET", scope: "server", example: "changed" },
      { key: "API_URL", scope: "server", example: "http://x" },
    ],
    resolvePath: (name: string, relative: string) =>
      [resolveTarget("single", name), relative].filter(Boolean).join("/"),
  };
  applyEnv(options);
  expect(vfs.read(".env")).toBe("SECRET=mine\nAPI_URL=http://x\n");
  applyEnv(options);
  expect(vfs.read(".env")).toBe("SECRET=mine\nAPI_URL=http://x\n");
});
