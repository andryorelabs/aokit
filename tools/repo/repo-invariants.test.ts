import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function readText(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function readLines(path: string): string[] {
  return readText(path)
    .split("\n")
    .map((line) => line.trim());
}

function rootScripts(): Readonly<Record<string, unknown>> {
  const manifest: unknown = JSON.parse(readText("package.json"));
  if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) {
    throw new Error("package.json has no scripts");
  }
  const scripts: unknown = manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    throw new Error("package.json scripts is not an object");
  }
  return Object.fromEntries(Object.entries(scripts));
}

/** Every file under `directory`, as paths relative to the repository root. */
function filesUnder(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(ROOT.length));
}

describe("root scripts (standard E1)", () => {
  const scripts = rootScripts();

  test.each([
    "check",
    "test",
    "fix",
    "format:check",
    "format:write",
    "lint:docs",
    "lint:commits",
    "ci:local",
  ])("%s exists", (name) => {
    expect(typeof scripts[name]).toBe("string");
  });

  test("the old format script is gone", () => {
    expect(scripts["format"]).toBeUndefined();
  });

  test("check runs typecheck, lint, format:check and knip", () => {
    expect(scripts["check"]).toBe(
      "bun run typecheck && bun run lint && bun run format:check && bun run knip",
    );
  });

  test("ci:local runs the frozen install, check, lint:docs, test and lint:commits in order", () => {
    expect(scripts["ci:local"]).toBe(
      "bun install --frozen-lockfile && bun run check && bun run lint:docs && bun run test && bun run lint:commits",
    );
  });
});

describe("git attributes and ignores (standard B6, H4)", () => {
  test(".gitattributes normalizes line endings and marks generated files", () => {
    const lines = readLines(".gitattributes");
    expect(lines).toContain("* text=auto eol=lf");
    expect(lines).toContain("registry/** linguist-generated=true");
    expect(lines).toContain("bun.lock linguist-generated=true");
  });

  test.each([".emet/*", ".claude/worktrees/", ".env", ".env.keys"])(
    ".gitignore covers %s",
    (entry) => {
      expect(readLines(".gitignore")).toContain(entry);
    },
  );
});

describe("GitHub Discussions (standard A8)", () => {
  test("no community file links to Discussions", () => {
    const files = [...filesUnder(".github"), "README.md", "CONTRIBUTING.md"];
    const offenders = files.filter((path) =>
      /github\.com\/[^\s)]+\/discussions/i.test(readText(path)),
    );
    expect(offenders).toEqual([]);
  });
});
