import { describe, expect, test } from "bun:test";
import type { FileContent } from "../../src/engine/vfs.ts";
import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, hashOf, lockfileOf, vfsOf, type FixtureFiles } from "./harness.ts";

interface Scenario {
  readonly base: FixtureFiles;
  readonly next: FixtureFiles;
  readonly user: Record<string, FileContent>;
  readonly ejected?: Record<string, "ejected">;
}

function run(scenario: Scenario) {
  const reads: string[] = [];
  const result = mergeProject({
    base: vfsOf(scenario.base),
    next: builtOf(scenario.next),
    readUser: async (path) => {
      reads.push(path);
      return scenario.user[path];
    },
    lockfile: lockfileOf(scenario.base, scenario.ejected),
    merger: createMerger(),
    driftOf,
  });
  return result.then((merged) => ({ ...merged, reads }));
}

const nulBytes = (value: number) => new Uint8Array([0, value, 0]);
const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

describe("mergeProject", () => {
  test("pristine files take next", async () => {
    const result = await run({
      base: { "a.txt": "one\n" },
      next: { "a.txt": "two\n" },
      user: { "a.txt": "one\n" },
    });
    expect(result.plan.changes.map((c) => [c.type, c.path, c.content])).toEqual([
      ["update", "a.txt", "two\n"],
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.lockfile.files["a.txt"]?.hash).toBe(hashOf("two\n"));
  });

  test("text clean merge keeps user and next edits", async () => {
    const base = lines("a", "b", "c", "d", "e", "f");
    const result = await run({
      base: { "a.txt": base },
      next: { "a.txt": lines("a", "b", "c", "d", "e", "F") },
      user: { "a.txt": lines("A", "b", "c", "d", "e", "f") },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.plan.changes[0]?.content).toBe(lines("A", "b", "c", "d", "e", "F"));
  });

  test("text conflict writes markers and keeps the previous hash", async () => {
    const result = await run({
      base: { "a.txt": "x\n" },
      next: { "a.txt": "n\n" },
      user: { "a.txt": "u\n" },
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.merged).toContain("<<<<<<<");
    expect(conflict?.merged).toContain("|||||||");
    expect(conflict?.base).toBe("x\n");
    expect(conflict?.user).toBe("u\n");
    expect(result.lockfile.files["a.txt"]?.hash).toBe(hashOf("x\n"));
  });

  test("binary files yield a .aokit-new conflict and keep the user's bytes", async () => {
    const result = await run({
      base: { "img.bin": nulBytes(1) },
      next: { "img.bin": nulBytes(2) },
      user: { "img.bin": nulBytes(3) },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.merged).toBeUndefined();
    expect(result.conflicts[0]?.next).toEqual(nulBytes(2));
    expect(result.plan.changes).toEqual([]);
  });

  test("JSON merges structurally by key", async () => {
    const result = await run({
      base: { "tsconfig.json": '{\n  "a": 1\n}\n' },
      next: { "tsconfig.json": '{\n  "a": 1,\n  "b": 2\n}\n' },
      user: { "tsconfig.json": '{\n  // keep\n  "a": 1,\n  "c": 3\n}\n' },
    });
    expect(result.conflicts).toEqual([]);
    const merged = String(result.plan.changes[0]?.content);
    expect(merged).toContain("// keep");
    expect(merged).toContain('"b": 2');
    expect(merged).toContain('"c": 3');
  });

  test("a deleted file stays deleted and warns when next changed it", async () => {
    const result = await run({
      base: { "a.txt": "one\n" },
      next: { "a.txt": "two\n" },
      user: {},
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.vfs.has("a.txt")).toBe(false);
    expect(result.warnings.join("\n")).toContain("a.txt");
  });

  test("a deleted file stays deleted silently when next did not change it", async () => {
    const result = await run({ base: { "a.txt": "one\n" }, next: { "a.txt": "one\n" }, user: {} });
    expect(result.warnings).toEqual([]);
  });

  test("a file next creates over an unknown user file is a Conflict", async () => {
    const result = await run({
      base: {},
      next: { "new.txt": "next\n" },
      user: { "new.txt": "mine\n" },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.path).toBe("new.txt");
    expect(result.conflicts[0]?.base).toBe("");
    expect(result.lockfile.files["new.txt"]).toBeUndefined();
  });

  test("a JSON file next creates over an unknown user JSON file is a Conflict, not a merge", async () => {
    const result = await run({
      base: {},
      next: { "tsconfig.json": '{"b":2}\n' },
      user: { "tsconfig.json": '{"a":1}\n' },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.path).toBe("tsconfig.json");
  });

  test("a file next creates over identical user content is not a Conflict", async () => {
    const result = await run({
      base: {},
      next: { "new.txt": "same\n" },
      user: { "new.txt": "same\n" },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.plan.changes).toEqual([]);
  });

  test("a created file is a create with Provenance", async () => {
    const result = await run({ base: {}, next: { "new.txt": "x\n" }, user: {} });
    expect(result.plan.changes).toMatchObject([
      { type: "create", path: "new.txt", provenance: [{ module: "mod" }] },
    ]);
  });

  test("a file next removes is deleted when pristine", async () => {
    const result = await run({ base: { "a.txt": "one\n" }, next: {}, user: { "a.txt": "one\n" } });
    expect(result.plan.changes.map((c) => [c.type, c.path])).toEqual([["delete", "a.txt"]]);
    expect(result.plan.changes[0]?.provenance).toEqual([
      { module: "mod", entry: { kind: "remove" } },
    ]);
    expect(result.lockfile.files["a.txt"]).toBeUndefined();
  });

  test("a file next removes is kept with a warning when modified, and loses its owner", async () => {
    const result = await run({
      base: { "a.txt": "one\n" },
      next: {},
      user: { "a.txt": "mine\n" },
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.warnings.join("\n")).toContain("a.txt");
    expect(result.lockfile.files["a.txt"]).toBeUndefined();
    expect(result.vfs.read("a.txt")).toBe("mine\n");
  });

  test("a shared file keeps the remaining owner", async () => {
    const result = await run({
      base: { "a.txt": { content: "one\n", owners: ["mod", "other"] } },
      next: { "a.txt": { content: "two\n", owners: ["other"] } },
      user: { "a.txt": "one\n" },
    });
    expect(result.lockfile.files["a.txt"]?.owners).toEqual(["other"]);
  });

  test("bun.lock is never merged or read", async () => {
    const result = await run({
      base: { "bun.lock": "old\n" },
      next: { "bun.lock": "new\n" },
      user: { "bun.lock": "mine\n" },
    });
    expect(result.reads).not.toContain("bun.lock");
    expect(result.plan.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.lockfile.files["bun.lock"]?.hash).toBe(hashOf("old\n"));
  });

  test("ejected files are skipped and keep their entry", async () => {
    const result = await run({
      base: { "a.txt": "one\n" },
      next: { "a.txt": "two\n" },
      user: { "a.txt": "mine\n" },
      ejected: { "a.txt": "ejected" },
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.lockfile.files["a.txt"]).toEqual({
      owners: ["mod"],
      mode: "ejected",
      hash: hashOf("one\n"),
    });
  });

  test("volatile files keep the user's content", async () => {
    const result = await run({
      base: { "v.txt": { content: "a\n", volatile: true } },
      next: { "v.txt": { content: "b\n", volatile: true } },
      user: { "v.txt": "user\n" },
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.vfs.read("v.txt")).toBe("user\n");
  });

  describe("seeds", () => {
    test("a new seed is created", async () => {
      const result = await run({
        base: {},
        next: { "seed.md": { content: "hi\n", ownership: "seed" } },
        user: {},
      });
      expect(result.plan.changes.map((c) => [c.type, c.path])).toEqual([["create", "seed.md"]]);
      expect(result.lockfile.files["seed.md"]?.mode).toBe("seed");
    });

    test("an existing seed is left to the user", async () => {
      const result = await run({
        base: { "seed.md": { content: "hi\n", ownership: "seed" } },
        next: { "seed.md": { content: "hello\n", ownership: "seed" } },
        user: { "seed.md": "mine\n" },
      });
      expect(result.plan.changes).toEqual([]);
      expect(result.conflicts).toEqual([]);
      expect(result.lockfile.files["seed.md"]?.hash).toBe(hashOf("hi\n"));
    });

    test("a removed seed is deleted when pristine and solely owned", async () => {
      const result = await run({
        base: { "seed.md": { content: "hi\n", ownership: "seed" } },
        next: {},
        user: { "seed.md": "hi\n" },
      });
      expect(result.plan.changes.map((c) => [c.type, c.path])).toEqual([["delete", "seed.md"]]);
    });

    test("a removed seed is kept when modified", async () => {
      const result = await run({
        base: { "seed.md": { content: "hi\n", ownership: "seed" } },
        next: {},
        user: { "seed.md": "mine\n" },
      });
      expect(result.plan.changes).toEqual([]);
      expect(result.warnings.join("\n")).toContain("seed.md");
    });

    test("a removed seed is kept when shared with another owner", async () => {
      const result = await run({
        base: { "seed.md": { content: "hi\n", ownership: "seed", owners: ["mod", "other"] } },
        next: {},
        user: { "seed.md": "hi\n" },
      });
      expect(result.plan.changes).toEqual([]);
      expect(result.warnings).toHaveLength(1);
    });
  });

  test("CRLF user files merge and classify like LF", async () => {
    const pristine = await run({
      base: { "a.txt": "one\ntwo\n" },
      next: { "a.txt": "one\ntwo\n" },
      user: { "a.txt": "one\r\ntwo\r\n" },
    });
    expect(pristine.plan.changes).toEqual([]);

    const base = lines("a", "b", "c", "d", "e", "f");
    const merged = await run({
      base: { "a.txt": base },
      next: { "a.txt": lines("a", "b", "c", "d", "e", "F") },
      user: { "a.txt": lines("A", "b", "c", "d", "e", "f").replaceAll("\n", "\r\n") },
    });
    expect(merged.conflicts).toEqual([]);
    expect(merged.plan.changes[0]?.content).toBe(lines("A", "b", "c", "d", "e", "F"));
  });

  test("renames are never paired by identical content", async () => {
    const result = await run({
      base: { "old.txt": "same\n" },
      next: { "new.txt": "same\n" },
      user: { "old.txt": "same\n" },
    });
    expect(result.plan.changes.map((c) => `${c.type} ${c.path}`).toSorted()).toEqual([
      "create new.txt",
      "delete old.txt",
    ]);
  });

  test("the user side is read only for paths in the Lockfile or either Render", async () => {
    const result = await run({
      base: { "a.txt": "a\n" },
      next: { "b.txt": "b\n" },
      user: { "a.txt": "a\n", "unrelated.txt": "x\n" },
    });
    expect(result.reads.toSorted()).toEqual(["a.txt", "b.txt"]);
  });
  describe("exec bit", () => {
    const base = lines("a", "b", "c", "d", "e", "f");
    const nextText = lines("a", "b", "c", "d", "e", "F");

    async function runWithMode(user: string) {
      const next = builtOf({ "run.sh": nextText });
      next.plan.vfs.write("run.sh", nextText, { ownership: "managed", mode: "0755" });
      const result = await mergeProject({
        base: vfsOf({ "run.sh": base }),
        next,
        readUser: async () => user,
        lockfile: lockfileOf({ "run.sh": base }),
        merger: createMerger(),
        driftOf,
      });
      return result;
    }

    test("pristine files keep the mode", async () => {
      const result = await runWithMode(base);
      expect(result.plan.changes[0]?.mode).toBe("0755");
      expect(result.plan.vfs.get("run.sh")?.mode).toBe("0755");
    });

    test("both-sides-changed files keep the mode", async () => {
      const result = await runWithMode(lines("A", "b", "c", "d", "e", "f"));
      expect(result.conflicts).toEqual([]);
      expect(result.plan.changes[0]?.content).toBe(lines("A", "b", "c", "d", "e", "F"));
      expect(result.plan.changes[0]?.mode).toBe("0755");
      expect(result.plan.vfs.get("run.sh")?.mode).toBe("0755");
    });

    test("user-modified files that next leaves unchanged keep the mode", async () => {
      const next = builtOf({ "run.sh": base });
      next.plan.vfs.write("run.sh", base, { ownership: "managed", mode: "0755" });
      const edited = lines("A", "b", "c", "d", "e", "f");
      const result = await mergeProject({
        base: vfsOf({ "run.sh": base }),
        next,
        readUser: async () => edited,
        lockfile: lockfileOf({ "run.sh": base }),
        merger: createMerger(),
        driftOf,
      });
      expect(result.conflicts).toEqual([]);
      const change = result.plan.changes.find((c) => c.path === "run.sh");
      expect(change === undefined || change.mode === "0755").toBe(true);
      expect(result.plan.vfs.get("run.sh")?.mode).toBe("0755");
    });
  });
});
