import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MANIFEST_PATHS, findCopyDrift, readText } from "../brand/copy-drift.test";
import { checkDocsIndex } from "../docs/docs-invariant.test";
import { findStaleNames, readTrackedFiles } from "../docs/stale-names.test";

const repoRoot = resolve(import.meta.dir, "../..");
const skillsDirectory = resolve(repoRoot, ".claude/skills");

/** Returns the problems found when `skills-lock.json` and the skill directories disagree. */
function checkSkillsLock(
  lockedNames: readonly string[],
  directoryNames: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const name of directoryNames) {
    if (!lockedNames.includes(name)) {
      problems.push(`.claude/skills/${name} has no entry in skills-lock.json`);
    }
  }
  for (const name of lockedNames) {
    if (!directoryNames.includes(name)) {
      problems.push(`skills-lock.json lists ${name} but .claude/skills/${name} does not exist`);
    }
  }
  return problems;
}

function lockedSkillNames(): string[] {
  const lock: unknown = JSON.parse(readText("skills-lock.json"));
  if (typeof lock !== "object" || lock === null || !("skills" in lock)) {
    throw new Error("skills-lock.json has no skills");
  }
  const skills: unknown = lock.skills;
  if (typeof skills !== "object" || skills === null) {
    throw new Error("skills-lock.json skills is not an object");
  }
  return Object.keys(skills);
}

function skillDirectoryNames(): string[] {
  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("standard invariants", () => {
  test("no legacy slug or name outside the allowlist", () => {
    expect(findStaleNames(readTrackedFiles(repoRoot))).toEqual([]);
  });

  test("README slogan, manifest descriptions and brand copy agree", () => {
    const manifests = Object.fromEntries(MANIFEST_PATHS.map((path) => [path, readText(path)]));
    expect(
      findCopyDrift({
        copy: readText("docs/brand/copy.md"),
        readme: readText("README.md"),
        manifests,
      }),
    ).toEqual([]);
  });

  test("every doc is indexed in docs/README.md", () => {
    expect(checkDocsIndex(repoRoot)).toEqual([]);
  });

  test.skipIf(!existsSync(skillsDirectory))(
    "skills-lock.json and .claude/skills agree both ways",
    () => {
      expect(checkSkillsLock(lockedSkillNames(), skillDirectoryNames())).toEqual([]);
    },
  );

  test("a skill directory without a lock entry fails", () => {
    expect(checkSkillsLock(["a"], ["a", "b"])).toEqual([
      ".claude/skills/b has no entry in skills-lock.json",
    ]);
  });

  test("a lock entry without a skill directory fails", () => {
    expect(checkSkillsLock(["a", "b"], ["a"])).toEqual([
      "skills-lock.json lists b but .claude/skills/b does not exist",
    ]);
  });
});
