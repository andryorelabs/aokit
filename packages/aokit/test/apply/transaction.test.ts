import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplyError,
  apply,
  findLeftoverStash,
  lockfileName,
  removeLeftoverStash,
  writeConflicts,
  type ConflictWrite,
} from "../../src/apply/index.ts";
import { Vfs } from "../../src/engine/index.ts";
import { diffVfs, hashVfs, type Plan } from "../../src/engine/plan.ts";
import { openGit } from "../../src/git/index.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { parseLockfile, serializeLockfile } from "../../src/lockfile/index.ts";

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
  workspace = await mkdtemp(join(tmpdir(), "aokit-transaction-"));
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

function runGit(cwd: string, ...args: string[]): Promise<string> {
  return runGitChecked(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
}

async function readTree(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const pairs = await Promise.all(
    files.map(
      async (entry) =>
        [
          join(entry.parentPath, entry.name).slice(directory.length + 1),
          await readFile(join(entry.parentPath, entry.name), "utf8"),
        ] as const,
    ),
  );
  return Object.fromEntries(pairs.toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

function textConflict(path: string): ConflictWrite {
  return {
    path,
    merged: "<<<<<<< user\nu\n||||||| base\nb\n=======\nn\n>>>>>>> new\n",
    base: "b\n",
    user: "u\n",
    next: "n\n",
  };
}

test("the third of five renames failing restores the first two and the Lockfile", async () => {
  const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
  await Promise.all(names.map((name) => writeFile(join(project, name), `old ${name}\n`)));
  await writeFile(join(project, lockfileName), "{}\n");
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  for (const name of names) {
    next.write(name, `new ${name}\n`);
  }
  const plan = planFrom(base, next);
  await rm(join(project, "c.txt"));
  await mkdir(join(project, "c.txt", "blocker"), { recursive: true });
  await writeFile(join(project, "c.txt", "blocker", "keep"), "x");
  const before = await readTree(project);

  const failure = await apply(plan, await loadLockfile(), project).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApplyError);
  expect(failure).toMatchObject({ code: "IO_ERROR" });
  expect(await readTree(project)).toEqual(before);
  expect(await readFile(join(project, "a.txt"), "utf8")).toBe("old a.txt\n");
  expect(await readFile(join(project, lockfileName), "utf8")).toBe("{}\n");
  expect(await readdir(project)).not.toContain(".aokit");
});

test("a successful apply removes the stash and leaves nothing behind", async () => {
  await writeFile(join(project, "a.txt"), "old\n");
  await writeFile(join(project, lockfileName), "{}\n");
  const base = await Vfs.fromDirectory(project);
  const next = base.clone();
  next.write("a.txt", "new\n");

  await apply(planFrom(base, next), await loadLockfile(), project);

  expect(await readdir(project)).not.toContain(".aokit");
  expect(await findLeftoverStash(project)).toEqual([]);
});

test("a leftover stash is found and removed, outside and inside git", async () => {
  const outside = join(project, ".aokit", "stash", "2026-01-01T00-00-00.000Z-abc");
  await mkdir(outside, { recursive: true });
  expect(await findLeftoverStash(project)).toEqual([outside]);
  expect(await removeLeftoverStash(project)).toEqual([outside]);
  expect(await findLeftoverStash(project)).toEqual([]);
  expect(await readdir(project)).toEqual([]);

  await runGit(project, "init", "-q");
  const adapter = await openGit(project);
  const gitDirectory = (await adapter?.gitDir()) ?? "";
  const inside = join(gitDirectory, "aokit", "stash", "2026-01-01T00-00-00.000Z-abc");
  await mkdir(inside, { recursive: true });
  expect(await findLeftoverStash(project)).toEqual([inside]);
  await removeLeftoverStash(project);
  expect(await findLeftoverStash(project)).toEqual([]);
});

test("a conflict in a repo records stages 1, 2 and 3 and stages nothing", async () => {
  const path = "my file é.txt";
  await runGit(project, "init", "-q");
  await writeFile(join(project, path), "b\n");
  await runGit(project, "add", ".");
  await runGit(project, "commit", "-q", "-m", "init");
  await writeFile(join(project, path), "u\n");

  const adapter = await openGit(project);
  await writeConflicts(project, [textConflict(path)], adapter ?? undefined);

  const unmerged = await runGit(project, "-c", "core.quotepath=off", "ls-files", "-u");
  const stages = unmerged
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/)[2]);
  expect(stages).toEqual(["1", "2", "3"]);
  const all = await runGit(project, "-c", "core.quotepath=off", "ls-files", "-s");
  expect(all.split("\n").filter((line) => line.includes(" 0\t"))).toEqual([]);
  expect(await readFile(join(project, path), "utf8")).toContain("<<<<<<< user");
});

test("a conflict outside a repo writes markers and a binary sibling", async () => {
  await writeFile(join(project, "a.txt"), "u\n");
  await writeFile(join(project, "logo.png"), new Uint8Array([0, 1, 2]));
  const binary: ConflictWrite = {
    path: "logo.png",
    next: new Uint8Array([0, 9, 9]),
    base: "",
    user: "",
  };

  await writeConflicts(project, [textConflict("a.txt"), binary]);

  expect(await readFile(join(project, "a.txt"), "utf8")).toContain("||||||| base");
  expect([...(await readFile(join(project, "logo.png.aokit-new")))]).toEqual([0, 9, 9]);
  expect([...(await readFile(join(project, "logo.png")))]).toEqual([0, 1, 2]);
  expect(await readdir(project)).not.toContain(".git");
});

test("conflicted paths keep their previous Lockfile hash", async () => {
  const lockfile = await loadLockfile();
  const [conflictedPath = "", otherPath = ""] = Object.keys(lockfile.files);
  const changedHash = `sha256-${"f".repeat(64)}`;
  const entryOf = (path: string) => {
    const entry = lockfile.files[path];
    if (entry === undefined) {
      throw new Error(path);
    }
    return entry;
  };
  const next = {
    ...lockfile,
    files: {
      ...lockfile.files,
      [conflictedPath]: { ...entryOf(conflictedPath), hash: changedHash },
      [otherPath]: { ...entryOf(otherPath), hash: changedHash },
    },
  };
  await writeFile(join(project, lockfileName), serializeLockfile(lockfile));
  await mkdir(join(project, conflictedPath, ".."), { recursive: true });
  await writeFile(join(project, conflictedPath), "u\n");
  const base = await Vfs.fromDirectory(project);

  await apply(planFrom(base, base.clone()), next, project, {
    conflicts: [textConflict(conflictedPath)],
  });

  const written = parseLockfile(await readFile(join(project, lockfileName), "utf8")).lockfile;
  expect(written.files[conflictedPath]?.hash).toBe(entryOf(conflictedPath).hash);
  expect(written.files[otherPath]?.hash).toBe(changedHash);
  expect(await readFile(join(project, conflictedPath), "utf8")).toContain("<<<<<<< user");
});
