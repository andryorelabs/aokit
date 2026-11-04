import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDirectory = join(import.meta.dir, "..", "..", ".github", "workflows");

const usesLine = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S.*))?$/;
const pinnedReference = /^[^@\s]+@[0-9a-f]{40}$/;

/** Returns `file:line` descriptions of every `uses:` that is not pinned by SHA with a tag comment. */
export function findUnpinnedActions(file: string, text: string): string[] {
  const problems: string[] = [];
  text.split("\n").forEach((line, index) => {
    const match = usesLine.exec(line);
    if (match === null) return;
    const [, reference = "", tagComment] = match;
    if (reference.startsWith("./")) return;
    if (!pinnedReference.test(reference)) {
      problems.push(`${file}:${index + 1} ${reference} is not pinned to a 40-character SHA`);
    } else if (tagComment === undefined || !/^v?\d/.test(tagComment)) {
      problems.push(`${file}:${index + 1} ${reference} lacks a trailing version tag comment`);
    }
  });
  return problems;
}

describe("S13: workflow actions are pinned by commit SHA", () => {
  test("every uses: in .github/workflows pins a full SHA with a version comment", () => {
    const files = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((name) =>
      findUnpinnedActions(name, readFileSync(join(workflowsDirectory, name), "utf8")),
    );
    expect(problems).toEqual([]);
  });

  test("a tag reference fails and names the file and line", () => {
    const text = "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n";
    expect(findUnpinnedActions("ci.yml", text)).toEqual([
      "ci.yml:4 actions/checkout@v7 is not pinned to a 40-character SHA",
    ]);
  });

  test("a pinned reference without a tag comment fails", () => {
    const text = `      - uses: actions/checkout@${"a".repeat(40)}\n`;
    expect(findUnpinnedActions("ci.yml", text)).toHaveLength(1);
  });

  test("a pinned reference with a tag comment passes", () => {
    const text = `      - uses: actions/checkout@${"a".repeat(40)} # v7\n`;
    expect(findUnpinnedActions("ci.yml", text)).toEqual([]);
  });
});
