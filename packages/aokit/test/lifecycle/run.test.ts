import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runLifecycle, type LifecycleInput } from "../../src/lifecycle/index.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";
import { serializeLockfile } from "../../src/lockfile/serialize.ts";
import { builtOf, driftOf, lockfileOf, type FixtureFiles } from "../merge/harness.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aokit-lifecycle-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

async function git(...args: string[]): Promise<string> {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return out;
}

async function seedProject(files: FixtureFiles, settings: { git: boolean }): Promise<void> {
  const built = builtOf(files);
  await Promise.all(
    built.plan.vfs.paths().map(async (path) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), built.plan.vfs.read(path) ?? "");
    }),
  );
  await writeFile(join(dir, "aokit.lock.json"), serializeLockfile(lockfileOf(files)));
  if (settings.git) {
    await git("init", "-q");
    await git("add", "-A");
    await git("commit", "-q", "-m", "init");
  }
}

function options(
  base: FixtureFiles,
  next: FixtureFiles,
  extra: Partial<LifecycleInput> = {},
): LifecycleInput {
  return {
    dir,
    driftOf,
    allowDirty: false,
    dryRun: false,
    diff: false,
    install: false,
    render: {
      base: async () => builtOf(base),
      next: async () => builtOf(next),
    },
    ...extra,
  };
}

async function lockfileOnDisk() {
  return parseLockfile(await readFile(join(dir, "aokit.lock.json"), "utf8")).lockfile;
}

describe("runLifecycle", () => {
  test("applies a clean merge and writes the Lockfile", async () => {
    const base = { "a.txt": "one\n" };
    const next = { "a.txt": "two\n", "b.txt": "new\n" };
    await seedProject(base, { git: true });
    const result = await runLifecycle(options(base, next));
    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("new\n");
    expect(Object.keys((await lockfileOnDisk()).files)).toEqual(["a.txt", "b.txt"]);
  });

  test("reports conflicts, writes markers and keeps the previous hash", async () => {
    const base = { "a.txt": "x\n" };
    await seedProject(base, { git: true });
    await writeFile(join(dir, "a.txt"), "u\n");
    await git("commit", "-q", "-am", "user edit");
    const result = await runLifecycle(options(base, { "a.txt": "n\n" }));
    expect(result.conflicts).toHaveLength(1);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toContain("<<<<<<<");
    expect((await lockfileOnDisk()).files["a.txt"]?.hash).toBe(
      lockfileOf(base).files["a.txt"]?.hash,
    );
    expect(await git("ls-files", "-u")).toContain("a.txt");
  });

  test.each(["dryRun", "diff"] as const)(
    "%s writes nothing and returns the unified diff",
    async (flag) => {
      const base = { "a.txt": "one\n" };
      await seedProject(base, { git: true });
      const result = await runLifecycle(
        options(base, { "a.txt": "two\n" }, flag === "dryRun" ? { dryRun: true } : { diff: true }),
      );
      expect(result.applied).toBe(false);
      expect(result.diff).toContain("@@");
      expect(result.diff).toContain("+two");
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("one\n");
      expect(await git("status", "--porcelain")).toBe("");
    },
  );

  test("a dirty tree fails with DIRTY_TREE unless allowDirty", async () => {
    const base = { "a.txt": "one\n" };
    await seedProject(base, { git: true });
    await writeFile(join(dir, "notes.txt"), "x");
    expect(await failureOf(runLifecycle(options(base, base)))).toMatchObject({
      code: "DIRTY_TREE",
    });
    const result = await runLifecycle(options(base, base, { allowDirty: true }));
    expect(result.applied).toBe(true);
  });

  test("outside git it warns that no undo is available", async () => {
    const base = { "a.txt": "one\n" };
    await seedProject(base, { git: false });
    const result = await runLifecycle(options(base, { "a.txt": "two\n" }));
    expect(result.warnings.join("\n")).toContain("no undo");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two\n");
  });

  test("a missing Lockfile fails with LOCKFILE_MISSING", async () => {
    expect(await failureOf(runLifecycle(options({}, {})))).toMatchObject({
      code: "LOCKFILE_MISSING",
    });
  });

  test("installs only when package.json changed", async () => {
    const base = { "package.json": "{}\n" };
    await seedProject(base, { git: true });
    const calls: string[] = [];
    const installer = async (directory: string) => {
      calls.push(directory);
    };
    await runLifecycle(options(base, base, { install: true, installer }));
    expect(calls).toEqual([]);
    const result = await runLifecycle(
      options(base, { "package.json": '{"a":1}\n' }, { install: true, installer }),
    );
    expect(result.installed).toBe(true);
    expect(calls).toEqual([dir]);
  });

  test("an absent base merges two-way", async () => {
    const base = { "a.txt": "one\n" };
    await seedProject(base, { git: true });
    const result = await runLifecycle(
      options(
        base,
        { "a.txt": "two\n" },
        {
          render: { base: async () => undefined, next: async () => builtOf({ "a.txt": "two\n" }) },
        },
      ),
    );
    expect(result.applied).toBe(true);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two\n");
  });
});
