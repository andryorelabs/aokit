import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const commitlintBin = join(repositoryRoot, "node_modules", "@commitlint", "cli", "cli.js");

/**
 * Runs commitlint with the repository config on one commit message and
 * returns its exit code.
 */
async function lintCommitMessage(commitMessage: string): Promise<number> {
  const commitlintProcess = Bun.spawn([process.execPath, commitlintBin], {
    cwd: repositoryRoot,
    stdin: new Blob([commitMessage]),
    stdout: "pipe",
    stderr: "pipe",
  });
  return commitlintProcess.exited;
}

describe("commitlint config", () => {
  test("accepts a conventional commit with gitmoji", async () => {
    expect(
      await lintCommitMessage(
        "feat: ✨ bootstrap workspace\n\n- Added Bun workspaces\n\nRefs: AO-2682\n",
      ),
    ).toBe(0);
  });

  test("accepts a conventional commit without gitmoji", async () => {
    expect(await lintCommitMessage("fix: handle empty manifest\n")).toBe(0);
  });

  test("rejects a message without a conventional type", async () => {
    expect(await lintCommitMessage("bootstrap workspace\n")).not.toBe(0);
  });
});
