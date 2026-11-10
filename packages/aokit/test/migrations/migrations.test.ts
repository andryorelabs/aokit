import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { Vfs } from "../../src/engine/vfs.ts";
import { runMigrations, selectMigrations } from "../../src/migrations/index.ts";
import { readLocalRegistry, type LocalRegistry } from "../../src/registry/index.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { builtRegistry, cleanTemporaryDirectories } from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

async function rejection(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
  } catch (thrown) {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
  }
  return undefined;
}

const context = { now: new Date(0), random: () => 0 };

const moduleSource = (migrations: string) => `export default {
  name: "oxc",
  version: "3.0.0",
  description: "Fixture Module.",
  provides: ["lint", "format"],
  files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],
  migrations: [${migrations}],
};
`;

const marker = (label: string) => `import { defineMigration } from "@aokit/module";

export default defineMigration(({ vfs }) => {
  vfs.write("order.txt", (vfs.read("order.txt") ?? "") + "${label}\\n");
});
`;

const defaultMigrations = `
    { from: ">=1 <2", to: "2.0.0", stage: "before", script: "migrations/to-2.js" },
    { from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/to-3.js" },
    { from: ">=1 <3", to: "3.0.0", stage: "after", script: "migrations/to-3.after.js" },
`;

async function fixtureRegistry(
  migrations: string,
  scripts: Record<string, string>,
): Promise<LocalRegistry> {
  const path = await builtRegistry(async (source) => {
    await mkdir(join(source, "oxc", "migrations"), { recursive: true });
    await writeFile(join(source, "oxc", "module.ts"), moduleSource(migrations), "utf8");
    await Promise.all(
      Object.entries(scripts).map(([name, content]) =>
        writeFile(join(source, "oxc", "migrations", name), content, "utf8"),
      ),
    );
  });
  return readLocalRegistry(path, { cliVersion });
}

const defaultScripts = {
  "to-2.ts": marker("two"),
  "to-3.ts": marker("three"),
  "to-3.after.ts": marker("after"),
};

describe("selectMigrations", () => {
  const manifest = {
    migrations: [
      { from: ">=1 <4", to: "3.0.0", stage: "before", script: "c.js" },
      { from: ">=1 <2", to: "2.0.0", stage: "before", script: "b.js" },
      { from: ">=2", to: "4.0.0", stage: "after", script: "d.js" },
    ],
  } as const;

  test("picks matching Migrations ordered by `to`", () => {
    const scripts = selectMigrations(manifest, "1.0.0", "3.0.0").map((m) => m.script);
    expect(scripts).toEqual(["b.js", "c.js"]);
  });

  test("excludes a `to` at or below installed and one above target", () => {
    expect(selectMigrations(manifest, "2.0.0", "3.0.0").map((m) => m.script)).toEqual(["c.js"]);
    expect(selectMigrations(manifest, "1.0.0", "2.5.0").map((m) => m.script)).toEqual(["b.js"]);
    expect(selectMigrations(manifest, "3.0.0", "3.0.0")).toEqual([]);
  });

  test("excludes a Migration whose `from` range does not match", () => {
    expect(selectMigrations(manifest, "2.0.0", "4.0.0").map((m) => m.script)).toEqual([
      "c.js",
      "d.js",
    ]);
  });
});

describe("runMigrations", () => {
  const modules = [{ name: "oxc", installed: "1.0.0", target: "3.0.0" }];

  test("runs 1.0.0 -> 3.0.0 Migrations in `to` order, by stage", async () => {
    const registry = await fixtureRegistry(defaultMigrations, defaultScripts);
    const vfs = Vfs.empty();
    const before = await runMigrations({
      stage: "before",
      modules,
      vfs,
      answers: {},
      context,
      registry,
    });
    expect(vfs.read("order.txt")).toBe("two\nthree\n");
    expect(before.provenance.map((entry) => `${entry.stage}:${entry.to}`)).toEqual([
      "before:2.0.0",
      "before:3.0.0",
    ]);
    await runMigrations({ stage: "after", modules, vfs, answers: {}, context, registry });
    expect(vfs.read("order.txt")).toBe("two\nthree\nafter\n");
  });

  test("runs Modules in the given order", async () => {
    const registry = await fixtureRegistry(defaultMigrations, defaultScripts);
    const vfs = Vfs.empty();
    const result = await runMigrations({
      stage: "before",
      modules: [
        { name: "oxc", installed: "1.0.0", target: "3.0.0" },
        { name: "oxc", installed: "2.0.0", target: "3.0.0" },
      ],
      vfs,
      answers: {},
      context,
      registry,
    });
    expect(result.provenance.map((entry) => `${entry.from}->${entry.to}`)).toEqual([
      "1.0.0->2.0.0",
      "1.0.0->3.0.0",
      "2.0.0->3.0.0",
    ]);
  });

  test("a before Migration that renames an answer returns the migrated answers", async () => {
    const registry = await fixtureRegistry(
      '{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/rename.js" }',
      {
        "rename.ts": `import { defineMigration } from "@aokit/module";
export default defineMigration(({ answers }) => {
  const { appRouter, ...rest } = answers;
  return { ...rest, router: appRouter };
});
`,
      },
    );
    const result = await runMigrations({
      stage: "before",
      modules,
      vfs: Vfs.empty(),
      answers: { oxc: { appRouter: "tanstack", keep: 1 }, other: { x: true } },
      context,
      registry,
    });
    expect(result.answers).toEqual({ oxc: { keep: 1, router: "tanstack" }, other: { x: true } });
  });

  test("passes the injected deterministic context", async () => {
    const registry = await fixtureRegistry(
      '{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/ctx.js" }',
      {
        "ctx.ts": `import { defineMigration } from "@aokit/module";
export default defineMigration(({ vfs, context }) => {
  vfs.write("ctx.txt", String(context.now.getTime()) + ":" + context.random());
});
`,
      },
    );
    const vfs = Vfs.empty();
    await runMigrations({
      stage: "before",
      modules,
      vfs,
      answers: {},
      context: { now: new Date(1234), random: () => 0.5 },
      registry,
    });
    expect(vfs.read("ctx.txt")).toBe("1234:0.5");
  });

  test("a throwing Migration raises MIGRATION_FAILED naming Module, script and range", async () => {
    const registry = await fixtureRegistry(
      '{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/boom.js" }',
      { "boom.ts": 'export default () => { throw new Error("kaboom"); };\n' },
    );
    const error = await rejection(
      runMigrations({
        stage: "before",
        modules,
        vfs: Vfs.empty(),
        answers: {},
        context,
        registry,
      }),
    );
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error instanceof AokitError ? error.fix.length : 0).toBeGreaterThan(0);
    expect(error?.message).toContain("oxc");
    expect(error?.message).toContain("migrations/boom.js");
    expect(error?.message).toContain("1.0.0 -> 3.0.0");
    expect(error?.message).toContain("kaboom");
  });

  test("a script without a function default export raises MIGRATION_FAILED", async () => {
    const registry = await fixtureRegistry(
      '{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/bad.js" }',
      { "bad.ts": "export default 42;\n" },
    );
    const error = await rejection(
      runMigrations({
        stage: "before",
        modules,
        vfs: Vfs.empty(),
        answers: {},
        context,
        registry,
      }),
    );
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
  });

  test("an async Migration raises MIGRATION_FAILED instead of wiping answers", async () => {
    const registry = await fixtureRegistry(
      '{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/async.js" }',
      { "async.ts": "export default async () => ({ router: 1 });\n" },
    );
    const error = await rejection(
      runMigrations({
        stage: "before",
        modules,
        vfs: Vfs.empty(),
        answers: { oxc: { appRouter: 1 } },
        context,
        registry,
      }),
    );
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error?.message).toContain("synchronous");
  });

  test("a target version the Registry lacks raises MODULE_VERSION_UNAVAILABLE", async () => {
    const registry = await fixtureRegistry(defaultMigrations, defaultScripts);
    const error = await rejection(
      runMigrations({
        stage: "before",
        modules: [{ name: "oxc", installed: "1.0.0", target: "9.0.0" }],
        vfs: Vfs.empty(),
        answers: {},
        context,
        registry,
      }),
    );
    expect(error).toMatchObject({ code: "MODULE_VERSION_UNAVAILABLE" });
  });
});
