import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, lockfileName, type ConflictWrite } from "../../src/apply/index.ts";
import { Vfs } from "../../src/engine/index.ts";
import { diffVfs, hashVfs, type Plan } from "../../src/engine/plan.ts";
import { AokitError } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { openGit } from "../../src/git/index.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { parseLockfile, serializeLockfile } from "../../src/lockfile/index.ts";
import {
  assertPlanFresh,
  deletePlanFile,
  fingerprintFiles,
  planFileSchema,
  planMissingError,
  readPlanFile,
  writePlanFile,
  type UpdatePlanFile,
} from "../../src/update/plan-file.ts";
import { abortUpdate, readUpdateMarker, writeUpdateMarker } from "../../src/update/state.ts";

const lockfileFixture = join(
  import.meta.dir,
  "..",
  "lockfile",
  "fixtures",
  "example.canonical.lock",
);

let workspace = "";
let project = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "aokit-update-state-"));
  project = join(workspace, "project");
  await mkdir(project);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runGit(cwd: string, ...args: string[]): Promise<string> {
  return runGitChecked(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
}

async function loadLockfile() {
  return parseLockfile(await readFile(lockfileFixture, "utf8")).lockfile;
}

function planFrom(base: Vfs, next: Vfs): Plan {
  return {
    changes: diffVfs(base, next, () => [{ module: "fixture", entry: { kind: "file", from: "x" } }]),
    hash: hashVfs(next),
    vfs: next,
  };
}

async function readTree(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const pairs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.parentPath.includes(`${directory}/.git`))
      .map(async (entry) => {
        const absolute = join(entry.parentPath, entry.name);
        return [absolute.slice(directory.length + 1), await readFile(absolute, "utf8")] as const;
      }),
  );
  return Object.fromEntries(pairs.toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

const conflict: ConflictWrite = {
  path: "b.txt",
  merged: "<<<<<<< user\nu\n||||||| base\nb\n=======\nn\n>>>>>>> new\n",
  base: "b\n",
  user: "u\n",
  next: "n\n",
};

const binaryConflict: ConflictWrite = {
  path: "logo.bin",
  next: new Uint8Array([0, 1, 2, 3]),
  base: "",
  user: "",
};

async function conflictedUpdate(useGit: boolean) {
  const lockfile = await loadLockfile();
  await writeFile(join(project, "a.txt"), "old a\n");
  await writeFile(join(project, "b.txt"), "u\n");
  await writeFile(join(project, "logo.bin"), new Uint8Array([9, 9]));
  await writeFile(join(project, lockfileName), serializeLockfile(lockfile));
  if (useGit) {
    await runGit(project, "init", "-q");
    await runGit(project, "add", ".");
    await runGit(project, "commit", "-q", "-m", "init");
  }
  const git = useGit ? ((await openGit(project)) ?? undefined) : undefined;
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  next.write("a.txt", "new a\n");
  next.write("fresh.txt", "created\n");
  const before = await readTree(project);
  const unmergedBefore = useGit ? await runGit(project, "ls-files", "-u") : "";
  const conflicts = [conflict, binaryConflict];
  const result = await apply(planFrom(base, next), lockfile, project, {
    git,
    conflicts,
    keepStash: true,
  });
  expect(result.stash).toBeDefined();
  return { git, before, unmergedBefore, stash: result.stash, lockfile };
}

describe("new error codes", () => {
  test("map to their documented exit codes", () => {
    expect(exitCodeForErrorCode("MIGRATION_FAILED")).toBe(1);
    expect(exitCodeForErrorCode("PLAN_STALE")).toBe(5);
    expect(exitCodeForErrorCode("PLAN_MISSING")).toBe(5);
  });
});

describe.each([true, false])("update marker and abort (git: %p)", (useGit) => {
  test("a kept stash plus a marker is undone completely by abortUpdate", async () => {
    const { git, before, unmergedBefore, stash } = await conflictedUpdate(useGit);
    if (stash === undefined) throw new Error("stash expected");
    expect(await stat(stash.directory)).toBeDefined();
    expect(await readTree(project)).not.toEqual(before);
    await writeUpdateMarker(project, git, {
      stashDirectory: stash.directory,
      conflictedPaths: ["b.txt"],
      newSiblingPaths: ["logo.bin.aokit-new"],
      createdPaths: [...stash.created],
      previousLockfile: serializeLockfile(await loadLockfile()),
    });
    expect(await readUpdateMarker(project, git)).toMatchObject({
      stashDirectory: stash.directory,
      conflictedPaths: ["b.txt"],
    });

    const result = await abortUpdate(project, git);

    expect(result?.restored).toEqual(expect.arrayContaining(["a.txt", "b.txt"]));
    expect(await readTree(project)).toEqual(before);
    expect(await readUpdateMarker(project, git)).toBeNull();
    expect(await exists(stash.directory)).toBe(false);
    if (useGit) {
      expect(await runGit(project, "ls-files", "-u")).toBe(unmergedBefore);
      expect(await runGit(project, "status", "--porcelain")).toBe("");
    } else {
      expect(await exists(join(project, ".aokit"))).toBe(false);
    }
  });

  test("with nothing to abort it returns null", async () => {
    await writeFile(join(project, lockfileName), "{}\n");
    const git = useGit ? (await runGit(project, "init", "-q"), await openGit(project)) : null;
    expect(await abortUpdate(project, git ?? undefined)).toBeNull();
  });

  test("abort deletes a saved Plan", async () => {
    await writeFile(join(project, lockfileName), "{}\n");
    const git = useGit ? (await runGit(project, "init", "-q"), await openGit(project)) : null;
    await writePlanFile(project, git ?? undefined, await samplePlan());
    expect(await abortUpdate(project, git ?? undefined)).toEqual({ restored: [] });
    expect(await readPlanFile(project, git ?? undefined)).toBeNull();
    await writePlanFile(project, git ?? undefined, await samplePlan());
    await deletePlanFile(project, git ?? undefined);
    expect(await readPlanFile(project, git ?? undefined)).toBeNull();
  });
});

test("the marker is kept per linked worktree git dir", async () => {
  await writeFile(join(project, "a.txt"), "a\n");
  await runGit(project, "init", "-q");
  await runGit(project, "add", ".");
  await runGit(project, "commit", "-q", "-m", "init");
  const linked = join(workspace, "linked");
  await runGit(project, "worktree", "add", "-q", "-b", "other", linked);
  const git = (await openGit(linked)) ?? undefined;
  await writeUpdateMarker(linked, git, {
    stashDirectory: join(workspace, "stash"),
    conflictedPaths: [],
    newSiblingPaths: [],
    previousLockfile: "{}\n",
  });
  const gitDirectory = await git?.gitDir();
  expect(gitDirectory).not.toBe(join(linked, ".git"));
  expect(await stat(join(gitDirectory ?? "", "aokit", "update.json"))).toBeDefined();
  expect(await readUpdateMarker(project, (await openGit(project)) ?? undefined)).toBeNull();
});

async function samplePlan(): Promise<UpdatePlanFile> {
  const lockfile = await loadLockfile();
  const base = Vfs.empty();
  base.write("src/ünï cödé/a b.txt", "old\n");
  base.write("bin.dat", new Uint8Array([0, 255, 128, 7]));
  const next = base.clone();
  next.write("src/ünï cödé/a b.txt", "new\n");
  next.write("bin.dat", new Uint8Array([0, 255, 1, 2, 3]), { mode: "755" });
  next.write("src/router.tsx", "router\n", { ownership: "seed" });
  const plan = planFrom(base, next);
  return {
    cliVersion: "1.2.3",
    targetRelease: "2026.11.1",
    lockfileHash: null,
    userFileHashes: { "src/ünï cödé/a b.txt": null, "bin.dat": null },
    plan,
    conflicts: [conflict, binaryConflict],
    targetLockfile: lockfile,
  };
}

describe("plan file", () => {
  test("round-trips binary content, odd paths, conflicts and the target Lockfile", async () => {
    const plan = await samplePlan();
    await writePlanFile(project, undefined, plan);

    const read = await readPlanFile(project, undefined);

    expect(read?.cliVersion).toBe("1.2.3");
    expect(read?.targetRelease).toBe("2026.11.1");
    expect(read?.plan.hash).toBe(plan.plan.hash);
    expect(read?.plan.changes).toEqual(plan.plan.changes);
    expect(read?.conflicts).toEqual([...plan.conflicts]);
    expect(read?.targetLockfile).toEqual(plan.targetLockfile);
    expect(read?.plan.vfs.read("bin.dat")).toEqual(new Uint8Array([0, 255, 1, 2, 3]));
    expect(read?.plan.vfs.read("src/router.tsx")).toBe("router\n");
    const onDisk = JSON.parse(await readFile(join(project, ".aokit", "plan.json"), "utf8"));
    expect(planFileSchema.safeParse(onDisk).success).toBe(true);
    expect(JSON.stringify(onDisk)).toContain('"encoding":"base64"');
  });

  test("lives in the git dir inside a repository", async () => {
    await runGit(project, "init", "-q");
    const git = (await openGit(project)) ?? undefined;
    await writePlanFile(project, git, await samplePlan());
    expect(await stat(join(project, ".git", "aokit", "plan.json"))).toBeDefined();
    expect(await exists(join(project, ".aokit"))).toBe(false);
  });

  test("a missing plan reads as null and PLAN_MISSING is exit 5", async () => {
    expect(await readPlanFile(project, undefined)).toBeNull();
    const error = planMissingError();
    expect(error.code).toBe("PLAN_MISSING");
    expect(exitCodeForErrorCode(error.code)).toBe(5);
  });

  test("an invalid plan is INVALID_INPUT", async () => {
    await mkdir(join(project, ".aokit"));
    await writeFile(join(project, ".aokit", "plan.json"), '{"cliVersion":"1"}');
    const error = await failure(readPlanFile(project, undefined));
    expect(error).toBeInstanceOf(AokitError);
    expect(error).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("a path escaping the Project is rejected by the schema", async () => {
    const plan = await samplePlan();
    await writePlanFile(project, undefined, plan);
    const path = join(project, ".aokit", "plan.json");
    const text = (await readFile(path, "utf8")).replace("bin.dat", "../outside");
    await writeFile(path, text);
    expect(await failure(readPlanFile(project, undefined))).toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

async function plannedProject(): Promise<UpdatePlanFile> {
  await writeFile(join(project, lockfileName), "lock\n");
  await writeFile(join(project, "a.txt"), "a\n");
  const plan = await samplePlan();
  return {
    ...plan,
    lockfileHash: (await fingerprintFiles(project, [lockfileName]))[lockfileName] ?? null,
    userFileHashes: await fingerprintFiles(project, ["a.txt", "gone.txt"]),
  };
}

describe("assertPlanFresh", () => {
  test("passes when nothing changed", async () => {
    await assertPlanFresh(project, await plannedProject());
  });

  test("an edited file is PLAN_STALE naming it", async () => {
    const plan = await plannedProject();
    await writeFile(join(project, "a.txt"), "edited\n");
    const error = await failure(assertPlanFresh(project, plan));
    expect(error).toMatchObject({ code: "PLAN_STALE" });
    expect(messageOf(error)).toContain("a.txt");
    expect(exitCodeForErrorCode("PLAN_STALE")).toBe(5);
  });

  test("a line-ending-only edit is stale too", async () => {
    const plan = await plannedProject();
    await writeFile(join(project, "a.txt"), "a\r\n");
    expect(await failure(assertPlanFresh(project, plan))).toMatchObject({ code: "PLAN_STALE" });
  });

  test("a file that appeared since planning is stale", async () => {
    const plan = await plannedProject();
    await writeFile(join(project, "gone.txt"), "now here\n");
    const error = await failure(assertPlanFresh(project, plan));
    expect(messageOf(error)).toContain("gone.txt");
  });

  test("a file created at a Plan path after planning is stale", async () => {
    const plan = await plannedProject();
    const withCreate: UpdatePlanFile = {
      ...plan,
      plan: {
        ...plan.plan,
        changes: [
          ...plan.plan.changes,
          { ...plan.plan.changes[0]!, type: "create", path: "new.txt" },
        ],
      },
    };
    await writePlanFile(project, undefined, withCreate);
    await writeFile(join(project, "new.txt"), "user file\n");
    const saved = await readPlanFile(project, undefined);
    const error = await failure(assertPlanFresh(project, saved!));
    expect(messageOf(error)).toContain("new.txt");
  });

  test("a changed Lockfile is stale and named", async () => {
    const plan = await plannedProject();
    await writeFile(join(project, lockfileName), "other\n");
    const error = await failure(assertPlanFresh(project, plan));
    expect(error).toMatchObject({ code: "PLAN_STALE" });
    expect(messageOf(error)).toContain(lockfileName);
  });
});
