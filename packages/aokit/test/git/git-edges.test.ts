import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { assertCleanTree, openGit } from "../../src/git/index.ts";
import { runGitChecked } from "../../src/git/run.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

let root = "";
let repo = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "aokit-git-edges-")));
  repo = join(root, "repo");
  await mkdir(repo);
  await runGitChecked(repo, ["init", "-q"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function lockfileTracking(path: string): Lockfile {
  return {
    $schema: "https://example.test/lock.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: { [path]: { owners: ["m"], mode: "managed", hash: "sha256-old" } },
    deps: {},
  };
}

test("openGit resolves null when the directory does not exist", async () => {
  expect(await openGit(join(root, "missing"))).toBeNull();
});

test("mergeFile raises GIT_FAILED when git cannot merge the content", async () => {
  const opened = await openGit(repo);
  if (opened === null) throw new Error("expected a git repository");
  const labels = { user: "user", base: "base", new: "new" };

  const failure = await opened
    .mergeFile("a\0b\n", "a\0c\n", "a\0d\n", labels)
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AokitError);
  expect(failure).toMatchObject({ code: "GIT_FAILED" });
});

test("outside git a tracked file missing from disk counts as changed", async () => {
  const project = join(root, "plain");
  await mkdir(project);

  const failure = await assertCleanTree(project, {
    allowDirty: false,
    lockfile: lockfileTracking("gone.txt"),
  }).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: "DIRTY_TREE" });
  expect(failure instanceof Error ? failure.message : "").toContain("gone.txt");
});

test("outside git an unreadable tracked path is an error, not a dirty tree", async () => {
  const project = join(root, "plain");
  await mkdir(join(project, "dir.txt"), { recursive: true });
  await writeFile(join(project, "keep"), "x");

  const failure = await assertCleanTree(project, {
    allowDirty: false,
    lockfile: lockfileTracking("dir.txt"),
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(AokitError);
});
