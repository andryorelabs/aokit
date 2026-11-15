import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractChangelogSection } from "./changelog-section.ts";
import { promoteUnreleased } from "./promote-unreleased.ts";

const repositoryUrl = "https://github.com/andryorelabs/aokit";
const allowedGroups = new Set(["Added", "Changed", "Fixed"]);
const versionHeading = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/;

/** The problems found in a changelog against Keep a Changelog, SemVer and the aokit group rules. */
function findChangelogProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  if (!text.includes("[Keep a Changelog](https://keepachangelog.com/")) {
    problems.push("the preamble does not name Keep a Changelog");
  }
  if (!text.includes("[Semantic Versioning](https://semver.org/")) {
    problems.push("the preamble does not name Semantic Versioning");
  }
  const versions: string[] = [];
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const group = line.slice(4);
      if (!allowedGroups.has(group))
        problems.push(`group "${group}" is not Added, Changed or Fixed`);
    }
    if (!line.startsWith("## ")) continue;
    const match = versionHeading.exec(line);
    const name = match?.[1];
    if (name === undefined) {
      problems.push(`heading "${line}" is not "## [version] - YYYY-MM-DD"`);
      continue;
    }
    versions.push(name);
    if (name === "Unreleased" ? match?.[2] !== undefined : match?.[2] === undefined) {
      problems.push(`heading "${line}" has the wrong date for its kind`);
    }
  }
  if (versions[0] !== "Unreleased") problems.push("[Unreleased] is not the first section");
  const oldest = versions.at(-1);
  for (const name of versions) {
    const definition = lines.find((line) => line.startsWith(`[${name}]: `));
    const needsCompare = name !== oldest;
    if (definition === undefined) {
      problems.push(`version ${name} has no link definition`);
    } else if (needsCompare && !definition.includes("/compare/")) {
      problems.push(`version ${name} lacks a compare link`);
    }
  }
  return problems;
}

const sample = `# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Something.

## [0.2.0] - 2026-11-11

### Added

- A command.

## [0.1.0] - 2026-11-10

### Added

- First.

[Unreleased]: ${repositoryUrl}/compare/v0.2.0...HEAD
[0.2.0]: ${repositoryUrl}/compare/v0.1.0...v0.2.0
[0.1.0]: ${repositoryUrl}/releases/tag/v0.1.0
`;

describe("CHANGELOG.md format", () => {
  const text = readFileSync(join(import.meta.dir, "..", "..", "CHANGELOG.md"), "utf8");

  test("the repository changelog has no problems", () => {
    expect(findChangelogProblems(text)).toEqual([]);
  });

  test("every released version has a non-empty section", () => {
    const versions = [...text.matchAll(/^## \[(\d[^\]]*)\]/gm)].map((match) => match[1] ?? "");
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(extractChangelogSection(text, version).length).toBeGreaterThan(0);
    }
  });

  test("a well-formed sample has no problems", () => {
    expect(findChangelogProblems(sample)).toEqual([]);
  });

  test("a version heading without a compare link fails", () => {
    const broken = sample.replace(`[0.2.0]: ${repositoryUrl}/compare/v0.1.0...v0.2.0\n`, "");
    expect(findChangelogProblems(broken)).toEqual(["version 0.2.0 has no link definition"]);
    const notCompare = sample.replace("compare/v0.1.0...v0.2.0", "releases/tag/v0.2.0");
    expect(findChangelogProblems(notCompare)).toEqual(["version 0.2.0 lacks a compare link"]);
  });

  test("a group other than Added, Changed or Fixed fails", () => {
    expect(findChangelogProblems(sample.replace("### Changed", "### Removed"))).toEqual([
      'group "Removed" is not Added, Changed or Fixed',
    ]);
  });

  test("a missing preamble fails", () => {
    expect(findChangelogProblems(sample.replace("Semantic Versioning", "versions"))).toEqual([
      "the preamble does not name Semantic Versioning",
    ]);
  });

  test("a released heading without a date fails", () => {
    expect(findChangelogProblems(sample.replace("## [0.2.0] - 2026-11-11", "## [0.2.0]"))).toEqual([
      'heading "## [0.2.0]" has the wrong date for its kind',
    ]);
  });
});

describe("promoteUnreleased", () => {
  const promoted = promoteUnreleased(sample, "0.3.0", "2026-12-01");

  test("moves the Unreleased entries into a dated section above the previous one", () => {
    expect(promoted).toContain(
      "## [Unreleased]\n\n## [0.3.0] - 2026-12-01\n\n### Changed\n\n- Something.\n\n## [0.2.0] - 2026-11-11",
    );
    expect(extractChangelogSection(promoted, "0.3.0")).toBe("### Changed\n\n- Something.");
  });

  test("rewrites the links: Unreleased from the new tag, the new version from the previous one", () => {
    expect(promoted).toContain(`[Unreleased]: ${repositoryUrl}/compare/v0.3.0...HEAD\n`);
    expect(promoted).toContain(`[0.3.0]: ${repositoryUrl}/compare/v0.2.0...v0.3.0\n`);
    expect(promoted).toContain(`[0.2.0]: ${repositoryUrl}/compare/v0.1.0...v0.2.0\n`);
  });

  test("the promoted file still passes the format check", () => {
    expect(findChangelogProblems(promoted)).toEqual([]);
  });

  test("fails when Unreleased holds no entry", () => {
    expect(() => promoteUnreleased(promoted, "0.4.0", "2026-12-02")).toThrow(
      "CHANGELOG.md [Unreleased] holds no entry to release",
    );
  });

  test("fails when the version already has a section", () => {
    expect(() => promoteUnreleased(sample, "0.2.0", "2026-12-01")).toThrow(
      "CHANGELOG.md already has a section for 0.2.0",
    );
  });

  test("fails without an Unreleased heading or link", () => {
    expect(() => promoteUnreleased("# Changelog\n", "1.0.0", "2026-12-01")).toThrow(
      'CHANGELOG.md has no "## [Unreleased]" heading',
    );
    expect(() =>
      promoteUnreleased(sample.replace(/^\[Unreleased\].*$/m, ""), "0.3.0", "2026-12-01"),
    ).toThrow("CHANGELOG.md has no [Unreleased] compare link to move");
  });
});
