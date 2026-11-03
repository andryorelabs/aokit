import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { volatileHash } from "../../src/drift/hash.ts";
import { assertCleanTree, openGit } from "../../src/git/index.ts";
import { createMerger } from "../../src/merger/index.ts";
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
    lockfileVersion: 2,
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
  const labels = { base: "base", user: "yours", new: "aokit" };
  const clean = await opened?.mergeFile("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n", labels);
  expect(clean).toEqual({ content: "A\nb\nC\n", conflict: false });
  const conflicted = await opened?.mergeFile("a\n", "u\n", "n\n", labels);
  expect(conflicted?.conflict).toBe(true);
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

test("clearConflictStages removes the stages and leaves nothing unmerged", async () => {
  const path = "clear me.txt";
  await writeFile(join(repo, path), "worktree\n");
  const opened = await openGit(repo);
  await opened?.writeConflictStages(path, { base: "b\n", user: "u\n", next: "n\n" });
  await opened?.clearConflictStages(path);
  expect(await git(repo, "ls-files", "-u")).toBe("");
});

test("the real adapter yields the same markers as node-diff3 through the Merger", async () => {
  const opened = await openGit(repo);
  if (opened === null) throw new Error("expected a git repository");
  const input = { base: "a\nb\n", user: "a\nU\n", next: "a\nN\n", path: "x.txt" };
  const viaGit = await createMerger({ git: opened }).merge(input);
  const viaDiff3 = await createMerger().merge(input);
  expect(viaGit.conflict).toBe(true);
  expect(viaGit.content).toContain("||||||| base");
  expect(viaGit).toEqual(viaDiff3);
});

test("binary Uint8Array content keeps its bytes in the aokitNew payload", async () => {
  const next = new Uint8Array([0, 255, 254, 1]);
  const user = new Uint8Array([0, 2, 253]);
  const result = await createMerger().merge({
    base: new Uint8Array([0, 1]),
    user,
    next,
    path: "logo.png",
  });
  expect(result.conflict).toBe(true);
  expect(result.aokitNew).toEqual(next);
  expect(result.content).toEqual(user);
});

test("outside git a CRLF re-save of a pristine text file is not dirty", async () => {
  const project = join(root, "crlf");
  await mkdir(project);
  await writeFile(join(project, "a.txt"), "one\r\ntwo\r\n");
  const hash = `sha256-${createHash("sha256").update("one\ntwo\n").digest("hex")}`;
  const lockfile = {
    $schema: "https://example.test/lock.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: { "a.txt": { owners: ["m"], mode: "managed", hash } },
    deps: {},
  } as Lockfile;
  const result = await assertCleanTree(project, { allowDirty: false, lockfile });
  expect(result.warning).toBeDefined();
});

test("outside git an edited ejected file and a volatile file do not make the tree dirty", async () => {
  const project = join(root, "ejected");
  await mkdir(project);
  await writeFile(join(project, "ejected.txt"), "edited by the user");
  await writeFile(join(project, "volatile.txt"), "anything");
  const lockfile = {
    $schema: "https://example.test/lock.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: {
      "ejected.txt": { owners: ["m"], mode: "ejected", hash: "sha256-old" },
      "volatile.txt": { owners: ["m"], mode: "managed", hash: volatileHash },
    },
    deps: {},
  } as Lockfile;
  const result = await assertCleanTree(project, { allowDirty: false, lockfile });
  expect(result.warning).toBeDefined();
});
