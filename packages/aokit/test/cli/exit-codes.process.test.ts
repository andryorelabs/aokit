import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  createProject as createFixtureProject,
  editLockfileJson,
} from "../diff/support.ts";
import { spawnAokit as spawnAokitProcess } from "../helpers/aokit-process.ts";
import { commitAll, createProject, git, newWorkspace } from "../restore/helpers.ts";
import { jsonAt } from "../helpers/cli-json.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

afterEach(cleanTemporaryDirectories);

function spawnAokit(argv: string[]) {
  return spawnAokitProcess(argv, { env: { NO_COLOR: "1", FORCE_COLOR: "" } });
}

async function committedProject(modules?: string): Promise<string> {
  const directory = await createProject(workspace, modules);
  await commitAll(directory);
  return directory;
}

describe("exit codes through a real process", () => {
  test("exit 1: doctor reports DRIFT on an edited managed file", async () => {
    const directory = await committedProject();
    await writeFile(join(directory, "src/main.tsx"), "edited\n");
    const result = await spawnAokit(["doctor", directory, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "DRIFT" } });
  });

  test("exit 2: check reports UPDATE_AVAILABLE for a newer Module version", async () => {
    const project = await createFixtureProject(await builtRegistry());
    const newer = await builtRegistry(async (sourceRoot) => {
      const path = join(sourceRoot, "oxc", "module.ts");
      const text = await Bun.file(path).text();
      await writeFile(path, text.replace('version: "1.0.0",', 'version: "1.1.0",'), "utf8");
    });
    await editLockfileJson(project, (lockfile) => {
      const registries: unknown = lockfile["registries"];
      const official = jsonAt(registries, "official");
      if (typeof official !== "object" || official === null) {
        throw new Error("official registry missing from lockfile");
      }
      Object.assign(official, { source: newer });
    });
    const result = await spawnAokit(["check", project, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "UPDATE_AVAILABLE" },
    });
  });

  test("exit 3: an unknown flag is invalid input", async () => {
    const result = await spawnAokit(["check", "--bogus"]);
    expect(result.exitCode).toBe(3);
  });

  test("exit 4: remove refuses while a dependent Module exists", async () => {
    const directory = await committedProject("docker,coolify");
    const result = await spawnAokit([
      "remove",
      "docker",
      "--directory",
      directory,
      "--no-install",
      "--json",
    ]);
    expect(result).toMatchObject({ exitCode: 4 });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "DEPENDENTS_EXIST" },
    });
  });

  test("exit 5: add refuses on a dirty tree", async () => {
    const directory = await committedProject("oxc");
    await writeFile(join(directory, "scratch.txt"), "uncommitted\n");
    const result = await spawnAokit([
      "add",
      "knip",
      "--directory",
      directory,
      "--yes",
      "--no-install",
      "--json",
    ]);
    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "DIRTY_TREE" } });
  });

  test("exit 6: recopy over an edited managed file leaves Conflicts", async () => {
    const directory = await committedProject();
    await writeFile(join(directory, "src/main.tsx"), "edited\n");
    await git(directory, "add", "-A");
    await git(directory, "commit", "-q", "-m", "edit");
    const result = await spawnAokit([
      "recopy",
      "--directory",
      directory,
      "--yes",
      "--no-install",
      "--json",
    ]);
    expect(result.exitCode).toBe(6);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "MERGE_CONFLICTS" },
    });
  });
});
