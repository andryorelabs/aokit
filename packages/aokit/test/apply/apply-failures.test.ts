import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplyError,
  apply,
  findLeftoverStash,
  lockfileName,
  type ConflictWrite,
} from "../../src/apply/index.ts";
import { createStash } from "../../src/apply/stash.ts";
import { Vfs } from "../../src/engine/index.ts";
import { diffVfs, hashVfs, type Plan } from "../../src/engine/plan.ts";
import { openGit } from "../../src/git/index.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";

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
  workspace = await mkdtemp(join(tmpdir(), "aokit-apply-failures-"));
  project = join(workspace, "project");
  await mkdir(project);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

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

function conflictAt(path: string): ConflictWrite {
  return {
    path,
    merged: "<<<<<<< user\nu\n||||||| base\nb\n=======\nn\n>>>>>>> new\n",
    base: "b\n",
    user: "u\n",
    next: "n\n",
  };
}

async function projectBlockingTheThirdRename() {
  const names = ["a.txt", "b.txt", "c.txt"];
  await Promise.all(names.map((name) => writeFile(join(project, name), `old ${name}\n`)));
  await writeFile(join(project, lockfileName), await readFile(lockfileFixture, "utf8"));
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  for (const name of names) next.write(name, `new ${name}\n`);
  const plan = planFrom(base, next);
  await rm(join(project, "c.txt"));
  await mkdir(join(project, "c.txt", "blocker"), { recursive: true });
  await writeFile(join(project, "c.txt", "blocker", "keep"), "x");
  return plan;
}

test("a failed commit clears the conflict stages it was about to record", async () => {
  await runGitChecked(project, ["init", "-q"]);
  const plan = await projectBlockingTheThirdRename();
  const git = (await openGit(project)) ?? undefined;

  const failure = await apply(plan, await loadLockfile(), project, {
    git,
    conflicts: [conflictAt("conflicted.txt")],
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApplyError);
  expect(await readFile(join(project, "a.txt"), "utf8")).toBe("old a.txt\n");
  expect(await runGitChecked(project, ["ls-files", "-u"])).toBe("");
});

test("a failed commit whose originals cannot be restored reports where they are", async () => {
  await runGitChecked(project, ["init", "-q"]);
  const plan = await projectBlockingTheThirdRename();
  const opened = await openGit(project);
  if (opened === null) throw new Error("expected a git repository");
  const git = {
    ...opened,
    clearConflictStages: () => Promise.reject(new Error("index is locked")),
  };

  const failure = await apply(plan, await loadLockfile(), project, {
    git,
    conflicts: [conflictAt("conflicted.txt")],
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApplyError);
  expect(failure).toMatchObject({ code: "IO_ERROR" });
  const message = failure instanceof Error ? failure.message : "";
  expect(message).toContain("could not be restored automatically");
  expect(message).toContain("index is locked");
  expect((await findLeftoverStash(project)).length).toBe(1);
});

test("removing a file that already vanished from the Project still applies", async () => {
  await writeFile(join(project, "gone.txt"), "x\n");
  await writeFile(join(project, "kept.txt"), "x\n");
  await writeFile(join(project, lockfileName), await readFile(lockfileFixture, "utf8"));
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  next.delete("gone.txt");
  const plan = planFrom(base, next);
  await rm(join(project, "gone.txt"));

  await apply(plan, await loadLockfile(), project);

  expect(await readdir(project)).toContain("kept.txt");
  expect(await readdir(project)).not.toContain("gone.txt");
});

test("removing a path that is now a directory fails and rolls back", async () => {
  await writeFile(join(project, "a.txt"), "old\n");
  await writeFile(join(project, "gone.txt"), "x\n");
  await writeFile(join(project, lockfileName), await readFile(lockfileFixture, "utf8"));
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  next.write("a.txt", "new\n");
  next.delete("gone.txt");
  const plan = planFrom(base, next);
  await rm(join(project, "gone.txt"));
  await mkdir(join(project, "gone.txt"));
  await writeFile(join(project, "gone.txt", "inner"), "x");

  const failure = await apply(plan, await loadLockfile(), project).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApplyError);
  expect(await readFile(join(project, "a.txt"), "utf8")).toBe("old\n");
});

test("a stash cannot be created for a path git or the filesystem refuses to inspect", async () => {
  const failure = await createStash(project, undefined, ["a".repeat(300)]).catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
});

test("looking for leftover stashes fails when the stash location is not a directory", async () => {
  await writeFile(join(project, ".aokit"), "not a directory");

  const failure = await findLeftoverStash(project).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
});
