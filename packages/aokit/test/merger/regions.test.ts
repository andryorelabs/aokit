import { describe, expect, test } from "bun:test";

import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { mergeRegionFile } from "../../src/merger/regions.ts";
import { mergeTextWithDiff3 } from "../../src/merger/text.ts";
import { regionDigest } from "../../src/patchers/markdown/regions.ts";
import { builtOf, driftOf, hashOf, lockfileOf, vfsOf } from "../merge/harness.ts";

const block = (id: string, body: string) =>
  `<!-- aokit:begin ${id} -->\n${body}\n<!-- aokit:end ${id} -->`;
const file = (...parts: string[]) => `${parts.join("\n\n")}\n`;

const mergeText = async (base: string, user: string, next: string) =>
  mergeTextWithDiff3(base, user, next);
const merger = createMerger();

function mergeAgents(base: string, user: string, next: string) {
  return merger.merge({ base, user, next, path: "AGENTS.md" });
}

describe("Region merger", () => {
  const header = block("aokit:header", "header");

  test("notes at the end survive an inserted Region, byte for byte", async () => {
    const base = file(header);
    const notes = "my notes\nsecond line  \n";
    const next = file(header, block("docker:agents", "docker"));
    const result = await mergeAgents(base, `${base}\n${notes}`, next);
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(`${next}\n${notes}`);
  });

  test("new Region lands after the closest earlier Region: header, A, X, C", async () => {
    const a = block("a:agents", "a");
    const c = block("c:agents", "c");
    const x = block("x:agents", "x");
    const base = file(header, a, c);
    const result = await mergeAgents(base, `${base}notes\n`, file(header, a, x, c));
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(`${file(header, a, x, c)}notes\n`);
  });

  test("unedited Regions take next", async () => {
    const base = file(header);
    const next = file(block("aokit:header", "header v2"));
    const result = await mergeAgents(base, `${base}notes\n`, next);
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(`${next}notes\n`);
  });

  test("an edit inside a Region merges with diff3 inside that Region only", async () => {
    const base = file(block("a:agents", "one\ntwo\nthree\nfour\nfive\nsix"));
    const user = `${file(block("a:agents", "ONE\ntwo\nthree\nfour\nfive\nsix"))}notes\n`;
    const next = file(block("a:agents", "one\ntwo\nthree\nfour\nfive\nSIX"));
    const result = await mergeAgents(base, user, next);
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(
      `${file(block("a:agents", "ONE\ntwo\nthree\nfour\nfive\nSIX"))}notes\n`,
    );
  });

  test("a conflicting edit keeps the markers inside the Region", async () => {
    const base = file(block("a:agents", "old"));
    const user = `intro\n\n${file(block("a:agents", "mine"))}`;
    const next = file(block("a:agents", "theirs"));
    const result = await mergeAgents(base, user, next);
    expect(result.conflict).toBe(true);
    const text = String(result.content);
    expect(text.startsWith("intro\n\n<!-- aokit:begin a:agents -->\n<<<<<<<")).toBe(true);
    expect(text).toContain(">>>>>>> new\n<!-- aokit:end a:agents -->");
  });

  test("unparseable markers give a Conflict", async () => {
    const user = "<!-- aokit:begin a:agents -->\nno end\n";
    const result = await mergeRegionFile({ base: "", user, next: file(header) }, mergeText);
    expect(result).toEqual({ content: user, conflict: true, unparseable: true });
  });

  test("malformed markers keep the user file and hand back the next content as aokitNew", async () => {
    const user = "<!-- aokit:begin a:agents -->\nno end\n";
    const next = file(header);
    const result = await mergeAgents("", user, next);
    expect(result).toEqual({ content: user, conflict: true, aokitNew: next });
  });

  test("adopting a CLAUDE.md that already imports AGENTS.md does not import it twice", async () => {
    const next = file(block("aokit:claude", "@AGENTS.md"));
    const result = await mergeAgents("", "@AGENTS.md\n\nmy notes\n", next);
    expect(result.conflict).toBe(false);
    const content = String(result.content);
    expect(content.match(/@AGENTS\.md/g)).toHaveLength(1);
    expect(content).toContain("my notes");
  });

  test("a user file without markers is adopted, header first, no Conflict", async () => {
    const next = file(header, block("hono:agents", "hono"));
    const result = await mergeAgents("", "# My project\n\nhand written\n", next);
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(`${next}\n# My project\n\nhand written\n`);
  });

  test("CLAUDE.md is adopted the same way", async () => {
    const next = file(block("aokit:claude", "@AGENTS.md"));
    const result = await merger.merge({ base: "", user: "mine\n", next, path: "CLAUDE.md" });
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(`${next}\nmine\n`);
  });

  test("removing a Module deletes only its Region", async () => {
    const base = file(header, block("docker:agents", "docker"));
    const user = `notes first\n\n${base}\ntail\n`;
    const result = await mergeAgents(base, user, file(header));
    expect(result.content).toBe(`notes first\n\n${file(header)}\ntail\n`);
  });

  test("a hand-deleted Region comes back", async () => {
    const base = file(header, block("a:agents", "a"));
    const result = await mergeAgents(base, `${file(header)}notes\n`, base);
    expect(result.content).toBe(`${base}notes\n`);
  });

  test("CRLF user text is normalized like every other file", async () => {
    const base = file(header);
    const result = await mergeAgents(base, `${base.replaceAll("\n", "\r\n")}notes\r\n`, base);
    expect(result.content).toBe(`${base}notes\n`);
  });
});

const regionDrift: typeof driftOf = ({ entry, user }) => {
  if (entry === undefined) return user === undefined ? "deleted" : "unknown";
  if (user === undefined) return "deleted";
  return hashOf(regionDigest(String(user))) === entry.hash ? "pristine" : "modified";
};

function run(
  base: Record<string, string>,
  next: Record<string, string>,
  user: Record<string, string>,
) {
  const lock = lockfileOf(base);
  for (const [path, content] of Object.entries(base)) {
    const entry = lock.files[path];
    if (entry) lock.files[path] = { ...entry, hash: hashOf(regionDigest(content)) };
  }
  return mergeProject({
    base: vfsOf(base),
    next: builtOf(next),
    readUser: async (path) => user[path],
    lockfile: lock,
    merger,
    driftOf: regionDrift,
  });
}

describe("Region files in the merge procedure", () => {
  const header = block("aokit:header", "header");
  test("a pristine Region file with notes outside markers keeps the notes", async () => {
    const base = file(header);
    const next = file(header, block("docker:agents", "docker"));
    const result = await run(
      { "AGENTS.md": base },
      { "AGENTS.md": next },
      { "AGENTS.md": `${base}notes\n` },
    );
    expect(result.conflicts).toEqual([]);
    expect(result.vfs.read("AGENTS.md")).toBe(`${next}notes\n`);
  });

  test("an existing user file without a Lockfile entry is adopted", async () => {
    const next = file(header);
    const result = await run({}, { "AGENTS.md": next }, { "AGENTS.md": "mine\n" });
    expect(result.conflicts).toEqual([]);
    expect(result.vfs.read("AGENTS.md")).toBe(`${next}\nmine\n`);
  });
});
