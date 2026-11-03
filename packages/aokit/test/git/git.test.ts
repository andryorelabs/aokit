import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { assertCleanTree, openGit } from "../../src/git/index.ts";
import { runGitChecked } from "../../src/git/run.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

let root = "";
let repo = "";

function git(cwd: string, ...args: string[]): Promise<string> {
  return runGitChecked(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aokit-git-"));
  repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "-q");
  await writeFile(join(repo, ".gitignore"), "ignored.log\n");
  await writeFile(join(repo, "tracked.txt"), "one\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function thrown(promise: Promise<unknown>): Promise<AokitError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AokitError) return error;
    throw error;
  }
  throw new Error("expected AokitError");
}

test("openGit returns null outside a repository", async () => {
  expect(await openGit(root)).toBeNull();
  expect(await openGit(repo)).not.toBeNull();
});

test("an untracked file fails the clean-tree check unless allowDirty", async () => {
  await writeFile(join(repo, "notes.txt"), "x");
  const error = await thrown(assertCleanTree(repo, { allowDirty: false }));
  expect(error.code).toBe("DIRTY_TREE");
  expect(error.message).toContain("notes.txt");
  expect(await assertCleanTree(repo, { allowDirty: true })).toEqual({});
});

test("modified tracked files are dirty and gitignored ones are not", async () => {
  await writeFile(join(repo, "ignored.log"), "x");
  expect(await assertCleanTree(repo, { allowDirty: false })).toEqual({});
  await writeFile(join(repo, "tracked.txt"), "two\n");
  const opened = await openGit(repo);
  expect(await opened?.dirtyPaths()).toEqual(["tracked.txt"]);
});

test("untrackedPaths respects gitignore and scope", async () => {
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src", "a.ts"), "");
  await writeFile(join(repo, "b.ts"), "");
  await writeFile(join(repo, "ignored.log"), "");
  const opened = await openGit(repo);
  expect(await opened?.untrackedPaths("src")).toEqual(["src/a.ts"]);
  expect((await opened?.untrackedPaths("."))?.toSorted()).toEqual(["b.ts", "src/a.ts"]);
});

test("gitDir resolves for a linked worktree whose .git is a file", async () => {
  const linked = join(root, "linked");
  await git(repo, "worktree", "add", "-q", "-b", "side", linked);
  const opened = await openGit(linked);
  const expected = (await git(linked, "rev-parse", "--absolute-git-dir")).trim();
  expect(await opened?.gitDir()).toBe(expected);
  expect(expected).toContain(join("worktrees", "linked"));
  expect(await assertCleanTree(linked, { allowDirty: false })).toEqual({});
});

test("outside git the check compares Lockfile hashes and warns", async () => {
  const project = join(root, "plain");
  await mkdir(project);
  await writeFile(join(project, "a.txt"), "hello");
  const hash = `sha256-${createHash("sha256").update("hello").digest("hex")}`;
  const lockfile: Lockfile = {
    $schema: "https://example.test/lock.json",
    lockfileVersion: 1,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: { "a.txt": { owners: ["m"], mode: "managed", hash } },
    deps: {},
  };
  const clean = await assertCleanTree(project, { allowDirty: false, lockfile });
  expect(clean.warning).toContain("no undo");
  await writeFile(join(project, "a.txt"), "edited");
  const error = await thrown(assertCleanTree(project, { allowDirty: false, lockfile }));
  expect(error.code).toBe("DIRTY_TREE");
  expect(error.message).toContain("a.txt");
  expect((await assertCleanTree(project, { allowDirty: true, lockfile })).warning).toContain(
    "no undo",
  );
});

test("mergeFile merges cleanly and reports conflicts with labels", async () => {
  const opened = await openGit(repo);
  const labels = { base: "base", user: "yours", next: "aokit" };
  const clean = await opened?.mergeFile("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n", labels);
  expect(clean).toEqual({ content: "A\nb\nC\n", conflicts: 0 });
  const conflicted = await opened?.mergeFile("a\n", "u\n", "n\n", labels);
  expect(conflicted?.conflicts).toBe(1);
  expect(conflicted?.content).toContain("<<<<<<< yours");
  expect(conflicted?.content).toContain(">>>>>>> aokit");
});

test("writeConflictStages records stages 1, 2, 3 without staging or committing", async () => {
  const path = "dir with space/café ünï.txt";
  await mkdir(join(repo, "dir with space"));
  await writeFile(join(repo, path), "worktree\n");
  const opened = await openGit(repo);
  const headBefore = await git(repo, "rev-parse", "HEAD");
  await opened?.writeConflictStages(path, { base: "b\n", user: "u\n", next: "n\n" });
  const unmerged = await git(repo, "-c", "core.quotepath=off", "ls-files", "-u");
  const stages = unmerged
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/)[2]);
  expect(stages).toEqual(["1", "2", "3"]);
  expect(unmerged).toContain(path);
  expect(await git(repo, "rev-parse", "HEAD")).toBe(headBefore);
  expect(await git(repo, "show", `:2:${path}`)).toBe("u\n");
});
