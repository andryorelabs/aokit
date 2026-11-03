import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { runCommand } from "../../src/cli/command.ts";
import { checkCommand } from "../../src/cli/commands/check.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfile,
} from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

async function runCheck(directory: string) {
  return runCommand(checkCommand, commandContext, { directory });
}

async function bumpOxc(sourceRoot: string, extra = ""): Promise<void> {
  const path = join(sourceRoot, "oxc", "module.ts");
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace('version: "1.0.0",', `version: "1.1.0",${extra}`), "utf8");
}

describe("aokit check", () => {
  test("an up-to-date Project exits 0", async () => {
    const project = await createProject(await builtRegistry());
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({ ok: true, data: { modules: [] } });
    expect(exitCodeForEnvelope(envelope)).toBe(0);
  });

  test("a newer Module version exits 2 with UPDATE_AVAILABLE data", async () => {
    const project = await createProject(await builtRegistry());
    const newer = await builtRegistry((source) => bumpOxc(source));
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = newer;
    });
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "UPDATE_AVAILABLE" },
      data: {
        modules: [{ name: "oxc", current: "1.0.0", available: "1.1.0", migration: false }],
      },
    });
    expect(exitCodeForEnvelope(envelope)).toBe(2);
  });

  test("a target manifest that declares a migration over the range sets migration", async () => {
    const project = await createProject(await builtRegistry());
    const newer = await builtRegistry(async (source) => {
      await bumpOxc(
        source,
        '\n  migrations: [{ from: "1.0.0", to: "1.1.0", stage: "before", script: "migrations/a.js" }],',
      );
      await mkdir(join(source, "oxc", "migrations"), { recursive: true });
      await writeFile(
        join(source, "oxc", "migrations", "a.ts"),
        "export default () => {};\n",
        "utf8",
      );
    });
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = newer;
    });
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({ data: { modules: [{ name: "oxc", migration: true }] } });
  });

  test("a target manifest that declares a migration whose `from` is a range sets migration", async () => {
    const project = await createProject(await builtRegistry());
    const newer = await builtRegistry(async (source) => {
      await bumpOxc(
        source,
        '\n  migrations: [{ from: ">=1 <2", to: "1.1.0", stage: "before", script: "migrations/a.js" }],',
      );
      await mkdir(join(source, "oxc", "migrations"), { recursive: true });
      await writeFile(
        join(source, "oxc", "migrations", "a.ts"),
        "export default () => {};\n",
        "utf8",
      );
    });
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = newer;
    });
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({ data: { modules: [{ name: "oxc", migration: true }] } });
  });

  test("a newer Release with no Module change still exits 2", async () => {
    const project = await createProject(await builtRegistry());
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].release = "2026.10.0";
    });
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "UPDATE_AVAILABLE" },
      data: { modules: [] },
    });
    expect(exitCodeForEnvelope(envelope)).toBe(2);
  });

  test("a missing Registry path exits 1", async () => {
    const project = await createProject(await builtRegistry());
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = join(project, "no-such-registry");
    });
    const envelope = await runCheck(project);
    expect(envelope).toMatchObject({ ok: false, error: { code: "IO_ERROR" } });
    expect(exitCodeForEnvelope(envelope)).toBe(1);
  });

  test("a URL Registry source exits 3", async () => {
    const project = await createProject(await builtRegistry());
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = "https://example.com/registry";
    });
    expect(exitCodeForEnvelope(await runCheck(project))).toBe(3);
  });
});
