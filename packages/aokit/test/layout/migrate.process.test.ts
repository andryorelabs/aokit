import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnAokit } from "../helpers/aokit-process.ts";
import { commitAll, createProject, git, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function aokit(argv: string[]) {
  return spawnAokit(argv, { env: { NO_COLOR: "1", FORCE_COLOR: "" } });
}

async function committedProject(): Promise<string> {
  const directory = await createProject(workspace, "oxc,vite-react,hono,knip");
  await commitAll(directory);
  return directory;
}

describe("aokit layout migrate through a real process", () => {
  test("--dry-run --json exits 0, prints rename changes and changes nothing", async () => {
    const directory = await committedProject();
    const result = await aokit([
      "layout",
      "migrate",
      "monorepo",
      "--directory",
      directory,
      "--dry-run",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(
      envelope.data.plan.changes.some((change: { type: string }) => change.type === "rename"),
    ).toBe(true);
    expect(await git(directory, "status", "--short")).toBe("");
  });

  test("--yes --json to the current Layout exits 0 with changed false", async () => {
    const directory = await committedProject();
    const result = await aokit([
      "layout",
      "migrate",
      "single",
      "--directory",
      directory,
      "--yes",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data.changed).toBe(false);
    expect(await git(directory, "status", "--short")).toBe("");
  });

  test("a dirty tree exits 5 with DIRTY_TREE", async () => {
    const directory = await committedProject();
    await writeFile(join(directory, "scratch.txt"), "x\n");
    const result = await aokit([
      "layout",
      "migrate",
      "monorepo",
      "--directory",
      directory,
      "--yes",
      "--json",
    ]);
    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout).error.code).toBe("DIRTY_TREE");
  });

  test("a missing Lockfile exits 5 with LOCKFILE_MISSING", async () => {
    const directory = join(workspace, "empty");
    await mkdir(directory, { recursive: true });
    const result = await aokit([
      "layout",
      "migrate",
      "monorepo",
      "--directory",
      directory,
      "--yes",
      "--json",
    ]);
    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout).error.code).toBe("LOCKFILE_MISSING");
  });

  test("a conflicted migration exits 6; update --abort names the owner; --abort restores", async () => {
    const directory = await committedProject();
    await mkdir(join(directory, "apps/web"), { recursive: true });
    await writeFile(join(directory, "apps/web/tsconfig.json"), "user owned\n");
    await git(directory, "add", "-A");
    await git(directory, "commit", "-q", "-m", "user file");
    const lockBefore = await readFile(join(directory, "aokit.lock.json"), "utf8");
    const conflicted = await aokit([
      "layout",
      "migrate",
      "monorepo",
      "--directory",
      directory,
      "--yes",
      "--json",
    ]);
    expect(conflicted.exitCode).toBe(6);
    expect(JSON.parse(conflicted.stdout).error.code).toBe("MERGE_CONFLICTS");
    const refused = await aokit(["update", "--directory", directory, "--abort", "--json"]);
    expect(refused.exitCode).toBe(3);
    expect(refused.stdout).toContain("aokit layout migrate --abort");
    const aborted = await aokit([
      "layout",
      "migrate",
      "--directory",
      directory,
      "--abort",
      "--json",
    ]);
    expect(aborted.exitCode).toBe(0);
    expect(await readFile(join(directory, "aokit.lock.json"), "utf8")).toBe(lockBefore);
    expect(await readFile(join(directory, "apps/web/tsconfig.json"), "utf8")).toBe("user owned\n");
    expect(await git(directory, "status", "--short")).toBe("");
  });
});
