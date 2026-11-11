import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

const staleNamePattern = /\b(forge|andryore-starter|andryore starter)\b/i;

const allowedPathPrefixes = ["docs/adr/", "docs/research/"];
const allowedPaths = new Set(["CHANGELOG.md", "tools/docs/stale-names.test.ts"]);

const linearProjectLiteral = "AndryOre Starter";
const linearProjectPath = "docs/agents/issue-tracker.md";

const redirectLiteral = "docs-and-forge";
const redirectPath = "docs/standards/README.md";

const allowedLiteralsByPath = new Map<string, string>([
  [linearProjectPath, linearProjectLiteral],
  [redirectPath, redirectLiteral],
]);

interface TrackedFile {
  path: string;
  content: string;
}

function isAllowedPath(path: string): boolean {
  return allowedPaths.has(path) || allowedPathPrefixes.some((prefix) => path.startsWith(prefix));
}

function findStaleNames(files: readonly TrackedFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (isAllowedPath(file.path)) continue;
    const allowedLiteral = allowedLiteralsByPath.get(file.path);
    const lines = file.content.split("\n");
    for (const [index, line] of lines.entries()) {
      const scanned = allowedLiteral === undefined ? line : line.replaceAll(allowedLiteral, "");
      if (staleNamePattern.test(scanned)) {
        problems.push(`${file.path}:${index + 1}: stale name outside the allowlist`);
      }
    }
  }
  return problems;
}

function readTrackedFiles(root: string): TrackedFile[] {
  const listing = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root });
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  }
  const files: TrackedFile[] = [];
  for (const path of listing.stdout.toString().split("\0")) {
    if (path === "") continue;
    const buffer = readFileSync(resolve(root, path));
    if (buffer.includes(0)) continue;
    files.push({ path, content: buffer.toString("utf8") });
  }
  return files;
}

describe("stale names", () => {
  test("flags a whole word forge outside the allowlist, naming file and line", () => {
    const problems = findStaleNames([
      { path: "docs/guide.md", content: "first line\nrun the forge command\n" },
    ]);
    expect(problems).toEqual(["docs/guide.md:2: stale name outside the allowlist"]);
  });

  test("flags the old product names case-insensitively", () => {
    const problems = findStaleNames([
      { path: "docs/a.md", content: "Forge\nandryore-starter\nAndryOre Starter" },
    ]);
    expect(problems).toHaveLength(3);
  });

  test("does not match forged or other words that merely contain forge", () => {
    const problems = findStaleNames([
      { path: "tools/x.ts", content: "a forged token\nunforgettable\nforgery" },
    ]);
    expect(problems).toEqual([]);
  });

  test("allows ADRs, the changelog, research notes and this test by path", () => {
    const files = [
      "docs/adr/0001-x.md",
      "docs/research/notes.md",
      "CHANGELOG.md",
      "tools/docs/stale-names.test.ts",
    ].map((path) => ({ path, content: "forge" }));
    expect(findStaleNames(files)).toEqual([]);
  });

  test("allows the Linear project literal only in the issue tracker doc", () => {
    const content = `Project: \`${linearProjectLiteral}\``;
    expect(findStaleNames([{ path: linearProjectPath, content }])).toEqual([]);
    expect(findStaleNames([{ path: "docs/agents/emet.md", content }])).toHaveLength(1);
  });

  test("allows the renamed page literal only in the standards index", () => {
    const content = `| \`${redirectLiteral}\` | [docs-and-emet](docs-and-emet.md) |`;
    expect(findStaleNames([{ path: redirectPath, content }])).toEqual([]);
    expect(findStaleNames([{ path: "docs/standards/tooling.md", content }])).toHaveLength(1);
    expect(findStaleNames([{ path: redirectPath, content: "the forge command" }])).toHaveLength(1);
  });

  test("still flags other stale names in the issue tracker doc", () => {
    const problems = findStaleNames([
      { path: linearProjectPath, content: `${linearProjectLiteral} and andryore-starter` },
    ]);
    expect(problems).toHaveLength(1);
  });

  test("no tracked file outside the allowlist contains a stale name", () => {
    expect(findStaleNames(readTrackedFiles(repoRoot))).toEqual([]);
  });
});
