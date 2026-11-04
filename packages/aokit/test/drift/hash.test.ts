import { describe, expect, test } from "bun:test";
import { lockfileDriftOf } from "../../src/drift/drift-of.ts";
import { hashFileBytes, hashTrackedFile } from "../../src/drift/hash.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const region = (body: string): string => `<!-- aokit:begin a -->\n${body}\n<!-- aokit:end a -->`;
const entry = (hash: string) => ({ owners: ["m"], mode: "managed" as const, hash });

describe("hashTrackedFile", () => {
  test("a Region file ignores text outside markers and CRLF", () => {
    const base = hashTrackedFile("AGENTS.md", encode(`mine\n${region("x")}\n`));
    expect(hashTrackedFile("AGENTS.md", encode(`other\n\n${region("x")}\nmore`))).toBe(base);
    const crlf = `mine\n${region("x")}\n`.replaceAll("\n", "\r\n");
    expect(hashTrackedFile("AGENTS.md", encode(crlf))).toBe(base);
  });

  test("an edit inside a Region changes the hash", () => {
    expect(hashTrackedFile("CLAUDE.md", encode(region("x")))).not.toBe(
      hashTrackedFile("CLAUDE.md", encode(region("y"))),
    );
  });

  test("any other file hashes its bytes", () => {
    const bytes = encode(`mine\n${region("x")}\n`);
    expect(hashTrackedFile("docs/AGENTS.md", bytes)).toBe(hashFileBytes(bytes));
    expect(hashTrackedFile("README.md", bytes)).toBe(hashFileBytes(bytes));
  });

  test("a malformed Region file falls back to its bytes", () => {
    const bytes = encode("<!-- aokit:begin a -->\nx\n");
    expect(hashTrackedFile("AGENTS.md", bytes)).toBe(hashFileBytes(bytes));
  });
});

describe("lockfileDriftOf", () => {
  test("text outside markers is pristine, an edit inside a Region is modified", () => {
    const recorded = hashTrackedFile("AGENTS.md", encode(region("x")));
    const outside = lockfileDriftOf({
      path: "AGENTS.md",
      entry: entry(recorded),
      user: `hi\n${region("x")}\nbye`,
    });
    const inside = lockfileDriftOf({
      path: "AGENTS.md",
      entry: entry(recorded),
      user: region("z"),
    });
    expect(outside).toBe("pristine");
    expect(inside).toBe("modified");
  });

  test("missing and untracked files", () => {
    expect(lockfileDriftOf({ path: "a", entry: undefined, user: undefined })).toBe("deleted");
    expect(lockfileDriftOf({ path: "a", entry: undefined, user: "x" })).toBe("unknown");
    expect(lockfileDriftOf({ path: "a", entry: entry("h"), user: undefined })).toBe("deleted");
  });
});
