import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cliVersion } from "../../src/cli/version.ts";
import { Vfs } from "../../src/engine/vfs.ts";
import { runMigrations } from "../../src/migrations/index.ts";
import { readLocalRegistry, type LocalRegistry } from "../../src/registry/index.ts";
import { builtRegistry, cleanTemporaryDirectories } from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

const repositoryRoot = join(import.meta.dir, "..", "..", "..", "..");
const context = { now: new Date(0), random: () => 0 };
const modules = [{ name: "oxc", installed: "1.0.0", target: "3.0.0" }];

async function rejection(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
  } catch (thrown) {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
  }
  return undefined;
}

async function registryWith(script: string): Promise<LocalRegistry> {
  const path = await builtRegistry(async (source) => {
    await mkdir(join(source, "oxc", "migrations"), { recursive: true });
    await writeFile(
      join(source, "oxc", "module.ts"),
      `export default {
  name: "oxc",
  version: "3.0.0",
  description: "Fixture Module.",
  provides: ["lint", "format"],
  files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],
  migrations: [{ from: ">=1 <3", to: "3.0.0", stage: "before", script: "migrations/m.js" }],
};
`,
      "utf8",
    );
    await writeFile(join(source, "oxc", "migrations", "m.ts"), script, "utf8");
  });
  return readLocalRegistry(path, { cliVersion });
}

async function failureOf(script: string): Promise<Error | undefined> {
  const registry = await registryWith(script);
  return rejection(
    runMigrations({ stage: "before", modules, vfs: Vfs.empty(), answers: {}, context, registry }),
  );
}

describe("a Migration script that cannot run", () => {
  test("a script that fails to load raises MIGRATION_FAILED", async () => {
    const registry = await registryWith("export default () => undefined;\n");
    const built = registry.version("oxc", "3.0.0")?.migrationScript("migrations/m.js");
    if (built === undefined) throw new Error("missing built script");
    await writeFile(built, "export default (;\n", "utf8");
    const error = await rejection(
      runMigrations({ stage: "before", modules, vfs: Vfs.empty(), answers: {}, context, registry }),
    );
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error?.message).toContain("migrations/m.js");
  });

  test("a script without a default export raises MIGRATION_FAILED", async () => {
    const error = await failureOf("export const named = 1;\n");
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error?.message).toContain("defineMigration");
  });

  test("a script whose Promise rejects raises MIGRATION_FAILED without an unhandled rejection", async () => {
    const error = await failureOf('export default async () => { throw new Error("late"); };\n');
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error?.message).toContain("synchronous");
  });

  test("a script that throws a non-Error value raises MIGRATION_FAILED", async () => {
    const error = await failureOf('export default () => { throw "plain text"; };\n');
    expect(error).toMatchObject({ code: "MIGRATION_FAILED" });
    expect(error?.message).toContain("plain text");
  });
});

async function runAfter(vfs: Vfs): Promise<void> {
  const registry = await readLocalRegistry(join(repositoryRoot, "registry"), { cliVersion });
  await runMigrations({
    stage: "after",
    modules: [{ name: "vite-react", installed: "1.0.0", target: "1.1.0" }],
    vfs,
    answers: {},
    context,
    registry,
  });
}

describe("vite-react routes-to-router Migration", () => {
  test("does nothing when the Project has no router.tsx", async () => {
    const vfs = Vfs.empty();
    vfs.write("apps/web/src/app.tsx", 'import { routes } from "./routes";\n');
    await runAfter(vfs);
    expect(vfs.read("apps/web/src/app.tsx")).toBe('import { routes } from "./routes";\n');
  });

  test("skips a source file that is not text", async () => {
    const vfs = Vfs.empty();
    const bytes = new Uint8Array([0, 1, 2]);
    vfs.write("apps/web/src/router.tsx", "export const routes = [];\n");
    vfs.write("apps/web/src/blob.ts", bytes);
    vfs.write("apps/web/src/app.tsx", 'import { routes } from "./routes";\n');
    await runAfter(vfs);
    expect(vfs.read("apps/web/src/blob.ts")).toEqual(bytes);
    expect(vfs.read("apps/web/src/app.tsx")).toBe('import { routes } from "./router";\n');
  });
});
