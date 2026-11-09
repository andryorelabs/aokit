import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockfileMissingMessage } from "../../src/cli/errors.ts";
import { spawnAokit } from "../helpers/aokit-process.ts";
import { jsonAt } from "../helpers/cli-json.ts";
import { newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();
const emptyDirectory = join(workspace, "empty");

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const commands: ReadonlyArray<readonly [string, (directory: string) => string[]]> = [
  ["doctor", (directory) => ["doctor", directory]],
  ["check", (directory) => ["check", directory]],
  ["recopy", (directory) => ["recopy", "--directory", directory]],
  ["restore", (directory) => ["restore", "src/main.tsx", "--directory", directory]],
  ["update", (directory) => ["update", "--directory", directory]],
  [
    "layout migrate",
    (directory) => ["layout", "migrate", "monorepo", "--directory", directory, "--yes"],
  ],
];

describe("a directory without a Lockfile through a real process", () => {
  test("the shared message names `aokit create`", () => {
    expect(lockfileMissingMessage).toContain("not an aokit Project");
    expect(lockfileMissingMessage).toContain("`aokit create`");
  });

  for (const [name, buildArgv] of commands) {
    test(`${name} exits 5 with the shared LOCKFILE_MISSING message`, async () => {
      await mkdir(emptyDirectory, { recursive: true });
      const result = await spawnAokit([...buildArgv(emptyDirectory), "--json"], {
        env: { NO_COLOR: "1", FORCE_COLOR: "" },
      });
      expect(result.exitCode).toBe(5);
      const envelope: unknown = JSON.parse(result.stdout);
      expect(jsonAt(envelope, "error", "code")).toBe("LOCKFILE_MISSING");
      expect(jsonAt(envelope, "error", "message")).toBe(lockfileMissingMessage);
      expect(jsonAt(envelope, "error", "fix")).toEqual(expect.any(String));
    });
  }
});
