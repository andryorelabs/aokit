import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runGit, runGitChecked } from "./run.ts";

/** Labels written into conflict markers by {@link Git.mergeFile}. */
interface MergeLabels {
  readonly base: string;
  readonly user: string;
  readonly new: string;
}

/** Result of a three-way merge of text content. */
interface MergeResult {
  readonly content: string;
  readonly conflict: boolean;
}

/** The three sides of a Conflict, written as index stages 1 (base), 2 (user) and 3 (next). */
interface ConflictStages {
  readonly base: string;
  readonly user: string;
  readonly next: string;
}

/** Thin adapter over the `git` CLI for one Project directory. */
export interface Git {
  /** Absolute path of the git directory; for a linked worktree this is its private gitdir. */
  gitDir(): Promise<string>;
  /** Repository-root-relative paths with uncommitted changes, untracked included, ignored excluded. */
  dirtyPaths(): Promise<string[]>;
  /** Untracked, non-ignored paths under `under`, relative to the Project directory. */
  untrackedPaths(under: string): Promise<string[]>;
  /** Three-way merges `user` and `next` over `base` with `git merge-file`, touching no tracked file. */
  mergeFile(base: string, user: string, next: string, labels: MergeLabels): Promise<MergeResult>;
  /** Records `path` as conflicted in the index (stages 1, 2, 3) without staging or committing. */
  writeConflictStages(path: string, stages: ConflictStages): Promise<void>;
}

const zeroObjectId = "0".repeat(40);

function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

function parseStatusPaths(output: string): string[] {
  const entries = splitNul(output);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  return paths;
}

async function mergeFileIn(
  dir: string,
  base: string,
  user: string,
  next: string,
  labels: MergeLabels,
): Promise<MergeResult> {
  const scratch = await mkdtemp(join(tmpdir(), "aokit-merge-"));
  try {
    await Promise.all([
      writeFile(join(scratch, "base"), base),
      writeFile(join(scratch, "user"), user),
      writeFile(join(scratch, "next"), next),
    ]);
    const result = await runGit(dir, [
      "merge-file",
      "-p",
      "--diff3",
      "-L",
      labels.user,
      "-L",
      labels.base,
      "-L",
      labels.new,
      join(scratch, "user"),
      join(scratch, "base"),
      join(scratch, "next"),
    ]);
    if (result.exitCode > 127) {
      throw new Error(`git merge-file failed (${result.exitCode}): ${result.stderr.trim()}`);
    }
    return { content: result.stdout, conflict: result.exitCode > 0 };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function hashObject(dir: string, content: string): Promise<string> {
  const id = await runGitChecked(dir, ["hash-object", "-w", "--stdin"], content);
  return id.trim();
}

function createGit(dir: string): Git {
  return {
    async gitDir() {
      const output = await runGitChecked(dir, ["rev-parse", "--git-dir"]);
      return resolve(dir, output.trim());
    },
    async dirtyPaths() {
      const output = await runGitChecked(dir, [
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=all",
      ]);
      return parseStatusPaths(output);
    },
    async untrackedPaths(under) {
      const output = await runGitChecked(dir, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        under,
      ]);
      return splitNul(output);
    },
    mergeFile: (base, user, next, labels) => mergeFileIn(dir, base, user, next, labels),
    async writeConflictStages(path, stages) {
      if (path.includes("\n") || path.includes("\0")) {
        throw new Error(`cannot record a conflict for a path with a newline or NUL: ${path}`);
      }
      const [base, user, next] = await Promise.all([
        hashObject(dir, stages.base),
        hashObject(dir, stages.user),
        hashObject(dir, stages.next),
      ]);
      const lines = [
        `0 ${zeroObjectId}\t${path}\0`,
        `100644 ${base} 1\t${path}\0`,
        `100644 ${user} 2\t${path}\0`,
        `100644 ${next} 3\t${path}\0`,
      ];
      await runGitChecked(dir, ["update-index", "-z", "--index-info"], lines.join(""));
    },
  };
}

/** Opens a {@link Git} for `dir`, or resolves `null` when `dir` is not inside a git repository. */
export async function openGit(dir: string): Promise<Git | null> {
  try {
    const probe = await runGit(dir, ["rev-parse", "--git-dir"]);
    return probe.exitCode === 0 ? createGit(dir) : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
