import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMerger, isBinary, type MergeFileFn } from "../../src/merger/index.ts";

function textOf(content: string | Uint8Array | null): string {
  if (typeof content !== "string") throw new Error("expected text content");
  return content;
}

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "aokit-merger-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const gitMergeFile: MergeFileFn = async (base, user, next, labels) => {
  const callDir = await mkdtemp(join(workDir, "call-"));
  const basePath = join(callDir, "base");
  const userPath = join(callDir, "user");
  const nextPath = join(callDir, "next");
  await Promise.all([
    writeFile(basePath, base),
    writeFile(userPath, user),
    writeFile(nextPath, next),
  ]);
  const gitProcess = Bun.spawn(
    [
      "git",
      "merge-file",
      "-p",
      "--diff3",
      "-L",
      labels.user,
      "-L",
      labels.base,
      "-L",
      labels.new,
      userPath,
      basePath,
      nextPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const content = await new Response(gitProcess.stdout).text();
  const exitCode = await gitProcess.exited;
  return { content, conflict: exitCode > 0 };
};

function toCrlf(text: string): string {
  return text.replaceAll("\n", "\r\n");
}

const withGit = createMerger({ git: { mergeFile: gitMergeFile } });
const withoutGit = createMerger();

describe("text merge", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";

  test("different lines merge cleanly in both implementations", async () => {
    const user = "ONE\ntwo\nthree\nfour\nfive\n";
    const next = "one\ntwo\nthree\nfour\nFIVE\n";
    const results = await Promise.all(
      [withGit, withoutGit].map((merger) => merger.merge({ base, user, next, path: "a.txt" })),
    );
    for (const result of results) {
      expect(result).toEqual({
        content: "ONE\ntwo\nthree\nfour\nFIVE\n",
        conflict: false,
      });
    }
  });

  test("same-line edits produce byte-identical markers", async () => {
    const user = "one\ntwo\nUSER\nfour\nfive\n";
    const next = "one\ntwo\nNEW\nfour\nfive\n";
    const fromGit = await withGit.merge({ base, user, next, path: "a.txt" });
    const fromDiff3 = await withoutGit.merge({ base, user, next, path: "a.txt" });
    expect(fromDiff3.conflict).toBe(true);
    expect(fromGit.content).toBe(
      "one\ntwo\n<<<<<<< user\nUSER\n||||||| base\nthree\n=======\nNEW\n>>>>>>> new\nfour\nfive\n",
    );
    expect(fromDiff3).toEqual(fromGit);
  });

  test("CRLF inputs merge and normalize identically to LF", async () => {
    const user = "one\ntwo\nUSER\nfour\nfive\n";
    const next = "one\ntwo\nNEW\nfour\nfive\n";
    const pairs = await Promise.all(
      [withGit, withoutGit].map(async (merger) => ({
        lf: await merger.merge({ base, user, next, path: "a.txt" }),
        crlf: await merger.merge({
          base: toCrlf(base),
          user: toCrlf(user),
          next: toCrlf(next),
          path: "a.txt",
        }),
      })),
    );
    for (const { lf, crlf } of pairs) expect(crlf).toEqual(lf);
  });
});

describe("binary files", () => {
  test("detects a NUL byte in the first 8 KB only", () => {
    expect(isBinary("ab\0cd")).toBe(true);
    expect(isBinary(`${"a".repeat(8192)}\0`)).toBe(false);
    expect(isBinary("plain")).toBe(false);
  });

  test("differing binary reports a conflict with an aokitNew payload", async () => {
    const result = await withoutGit.merge({
      base: "\0base",
      user: "\0user",
      next: "\0next",
      path: "logo.png",
    });
    expect(result).toEqual({ content: "\0user", conflict: true, aokitNew: "\0next" });
  });

  test("an unchanged binary is not a conflict", async () => {
    const result = await withoutGit.merge({
      base: "\0base",
      user: "\0same",
      next: "\0same",
      path: "logo.png",
    });
    expect(result).toEqual({ content: "\0same", conflict: false });
  });
});

describe("json merge", () => {
  const base = `{
  // compiler settings
  "compilerOptions": {
    "strict": true,
  },
}
`;

  test("keeps comments and both keys when each side adds a key", async () => {
    const user = base.replace('"strict": true,', '"strict": true,\n    "a": 1,');
    const next = base.replace('"strict": true,', '"strict": true,\n    "b": 2,');
    const result = await withoutGit.merge({ base, user, next, path: "tsconfig.json" });
    expect(result.conflict).toBe(false);
    expect(result.content).toContain("// compiler settings");
    expect(result.content).toContain('"a": 1');
    expect(result.content).toContain('"b": 2');
    const merged = textOf(result.content);
    expect(merged.indexOf('"a"')).toBeLessThan(merged.indexOf('"b"'));
  });

  test("arrays merge by value", async () => {
    const arrayBase = '{\n  "files": ["a", "b"]\n}\n';
    const user = '{\n  "files": ["a", "b", "u"]\n}\n';
    const next = '{\n  "files": ["a", "n"]\n}\n';
    const result = await withoutGit.merge({
      base: arrayBase,
      user,
      next,
      path: "package.json",
    });
    expect(result.conflict).toBe(false);
    expect(JSON.parse(textOf(result.content))).toEqual({ files: ["a", "u", "n"] });
  });

  test("a scalar changed on both sides falls back to a text merge with markers", async () => {
    const scalarBase = '{\n  "name": "base"\n}\n';
    const user = '{\n  "name": "user"\n}\n';
    const next = '{\n  "name": "new"\n}\n';
    const results = await Promise.all(
      [withGit, withoutGit].map((merger) =>
        merger.merge({ base: scalarBase, user, next, path: "package.json" }),
      ),
    );
    for (const result of results) {
      expect(result.conflict).toBe(true);
      expect(result.content).toContain("<<<<<<< user");
      expect(result.content).toContain("||||||| base");
      expect(result.content).toContain(">>>>>>> new");
    }
  });

  test("a key removed by next is removed when the user left it alone", async () => {
    const result = await withoutGit.merge({
      base: '{\n  "a": 1,\n  "b": 2\n}\n',
      user: '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n',
      next: '{\n  "a": 1\n}\n',
      path: "x.json",
    });
    expect(JSON.parse(textOf(result.content))).toEqual({ a: 1, c: 3 });
  });
});
