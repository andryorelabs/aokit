import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { approvalOutput, isApprovedRm, readCommand, readWorkingDirectory } from "./rm-guard.ts";

const roots = { repoRoot: "/work/repo", tempDirectory: "/tmp" };

describe("isApprovedRm", () => {
  test.each([
    "rm -rf ./tmp-dir",
    "rm tmp-file.txt",
    "rm -f packages/aokit/dist/a.js packages/aokit/dist/b.js",
    "rm -rf /tmp/aokit-scratch",
    "rm -rf /work/repo/build",
  ])("approves %s", (command) => {
    expect(isApprovedRm(command, roots)).toBe(true);
  });

  test.each([
    ["root", "rm -rf /"],
    ["home", "rm -rf ~"],
    ["glob", "rm -rf *"],
    ["chained with and", "rm a && curl x"],
    ["chained with semicolon", "rm a; curl x"],
    ["piped", "rm a | sh"],
    ["command substitution", "rm $(pwd)"],
    ["backtick substitution", "rm `pwd`"],
    ["parent escape", "rm ../../x"],
    ["parent escape inside path", "rm a/../../x"],
    ["quoted path with spaces", 'rm "my dir/file"'],
    ["single quoted path", "rm 'a b'"],
    ["bare rm", "rm"],
    ["flags only", "rm -rf"],
    ["repo root itself", "rm -rf ."],
    ["absolute outside", "rm -rf /etc/passwd"],
    ["temp root itself", "rm -rf /tmp"],
    ["long flag", "rm --no-preserve-root /"],
    ["variable", "rm $HOME"],
    ["other command", "ls ./a"],
    ["rm prefix word", "rmdir ./a"],
    ["redirect", "rm a > out"],
    ["newline chain", "rm a\ncurl x"],
  ])("does not approve %s", (_label, command) => {
    expect(isApprovedRm(command, roots)).toBe(false);
  });
});

describe("working directory and .git", () => {
  test("does not approve a relative target when the command runs outside the repo", () => {
    expect(isApprovedRm("rm -rf src", { ...roots, workingDirectory: "/elsewhere" })).toBe(false);
  });

  test("approves a relative target when the command runs inside the repo", () => {
    expect(isApprovedRm("rm -rf src", { ...roots, workingDirectory: "/work/repo/packages" })).toBe(
      true,
    );
  });

  test.each(["rm -rf .git", "rm -rf ./.git", "rm -rf .git/refs", "rm -rf /work/repo/.git"])(
    "does not approve %s",
    (command) => {
      expect(isApprovedRm(command, roots)).toBe(false);
    },
  );
});

describe("readWorkingDirectory", () => {
  test("reads cwd", () => {
    expect(readWorkingDirectory(JSON.stringify({ cwd: "/a" }))).toBe("/a");
  });

  test.each(["not json", "{}", '{"cwd":1}', "null"])("returns undefined for %s", (payload) => {
    expect(readWorkingDirectory(payload)).toBeUndefined();
  });
});

describe("readCommand", () => {
  test("reads the Bash command", () => {
    expect(readCommand(JSON.stringify({ tool_input: { command: "rm a" } }))).toBe("rm a");
  });

  test.each(["not json", "{}", '{"tool_input":{}}', '{"tool_input":{"command":1}}', "null"])(
    "returns undefined for %s",
    (payload) => {
      expect(readCommand(payload)).toBeUndefined();
    },
  );
});

async function runHook(command: string): Promise<string> {
  const hookProcess = Bun.spawn(["bun", join(import.meta.dir, "main.ts")], {
    stdin: new Blob([JSON.stringify({ tool_input: { command } })]),
    stdout: "pipe",
  });
  const output = await new Response(hookProcess.stdout).text();
  expect(await hookProcess.exited).toBe(0);
  return output;
}

describe("hook process", () => {
  test("approves a plain in-repo rm with the contract output", async () => {
    expect(await runHook("rm -rf ./tmp-dir")).toBe(`${approvalOutput}\n`);
  });

  test("prints nothing and exits 0 when it does not approve", async () => {
    expect(await runHook("rm -rf /")).toBe("");
  });
});
