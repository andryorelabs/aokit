import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractChangelogSection } from "./changelog-section.ts";

const changelog = `# Changelog

Intro paragraph.

## [Unreleased]

## [0.3.0] - 2026-12-01

### Added

## [0.2.0] - 2026-11-11

### Added

- A new command.

### Fixed

- A crash on start.

## [0.2.0-next.1] - 2026-11-10

- A pre-release entry.

## [0.1.0] - 2026-11-10

The first release.

[Unreleased]: https://github.com/andryorelabs/aokit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/andryorelabs/aokit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andryorelabs/aokit/releases/tag/v0.1.0
`;

describe("CHANGELOG section extractor", () => {
  test("returns the body of the section for the version, without its heading", () => {
    expect(extractChangelogSection(changelog, "0.2.0")).toBe(
      "### Added\n\n- A new command.\n\n### Fixed\n\n- A crash on start.",
    );
  });

  test("leaves the compare links out of the last section", () => {
    expect(extractChangelogSection(changelog, "0.1.0")).toBe("The first release.");
  });

  test("tells a pre-release from the release it precedes", () => {
    expect(extractChangelogSection(changelog, "0.2.0-next.1")).toBe("- A pre-release entry.");
  });

  test("reads a heading without brackets or a date", () => {
    expect(extractChangelogSection("## 1.0.0\n\n- Stable.\n", "1.0.0")).toBe("- Stable.");
  });

  test("fails when no section names the version", () => {
    expect(() => extractChangelogSection(changelog, "0.4.0")).toThrow(
      "CHANGELOG.md has no section for 0.4.0",
    );
  });

  test("does not take a version that only shares a prefix", () => {
    expect(() => extractChangelogSection(changelog, "0.2")).toThrow(
      "CHANGELOG.md has no section for 0.2",
    );
  });

  test("fails when the section holds only headings", () => {
    expect(() => extractChangelogSection(changelog, "0.3.0")).toThrow(
      "CHANGELOG.md section for 0.3.0 is empty",
    );
  });

  test("fails when the section holds nothing", () => {
    expect(() => extractChangelogSection(changelog, "Unreleased")).toThrow(
      "CHANGELOG.md section for Unreleased is empty",
    );
  });
});

describe("CHANGELOG.md", () => {
  const text = readFileSync(join(import.meta.dir, "..", "..", "CHANGELOG.md"), "utf8");

  test.each(["0.1.0", "0.2.0"])("has a non-empty section for the released tag v%s", (version) => {
    expect(extractChangelogSection(text, version).length).toBeGreaterThan(0);
  });

  test("follows Keep a Changelog: Unreleased first, dated sections and compare links", () => {
    const headings = text.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## [Unreleased]",
      "## [0.2.0] - 2026-11-11",
      "## [0.1.0] - 2026-11-10",
    ]);
    expect(text).toContain(
      "[Unreleased]: https://github.com/andryorelabs/aokit/compare/v0.2.0...HEAD",
    );
    expect(text).toContain(
      "[0.2.0]: https://github.com/andryorelabs/aokit/compare/v0.1.0...v0.2.0",
    );
    expect(text).toContain("[0.1.0]: https://github.com/andryorelabs/aokit/releases/tag/v0.1.0");
  });
});
