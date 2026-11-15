import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MANIFEST_PATHS, findCopyDrift, readText } from "../brand/copy-drift.test";
import { checkDocsIndex } from "../docs/docs-invariant.test";
import { findStaleNames, readTrackedFiles } from "../docs/stale-names.test";

const repoRoot = resolve(import.meta.dir, "../..");

const MODULE_SKILL_SOURCES: Readonly<Record<string, string>> = {
  "add-adr": "registry-src/adr-docs/files/skill/add-adr.md",
  "cut-release": "registry-src/release-skills/files/cut-release.md",
};

interface LockEntry {
  readonly computedHash?: unknown;
}

/** Returns the problems found when lock entries and their tracked Module sources disagree. */
function checkSkillsLock(
  lockEntries: Readonly<Record<string, LockEntry>>,
  sourceHashes: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(lockEntries)) {
    const sourceHash = sourceHashes[name];
    if (sourceHash === undefined) {
      problems.push(`skills-lock.json lists ${name} but no Module source backs it`);
    } else if (entry.computedHash !== sourceHash) {
      problems.push(`skills-lock.json hash for ${name} differs from its Module source`);
    }
  }
  for (const name of Object.keys(sourceHashes)) {
    if (!(name in lockEntries)) {
      problems.push(`Module skill ${name} has no entry in skills-lock.json`);
    }
  }
  return problems;
}

function readLockEntries(): Record<string, LockEntry> {
  const lock: unknown = JSON.parse(readText("skills-lock.json"));
  if (typeof lock !== "object" || lock === null || !("skills" in lock)) {
    throw new Error("skills-lock.json has no skills");
  }
  const skills: unknown = lock.skills;
  if (typeof skills !== "object" || skills === null) {
    throw new Error("skills-lock.json skills is not an object");
  }
  return Object.fromEntries(
    Object.entries(skills).map(([name, entry]): [string, LockEntry] => [
      name,
      { computedHash: Reflect.get(Object(entry), "computedHash") as unknown },
    ]),
  );
}

function moduleSourceHashes(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(MODULE_SKILL_SOURCES).map(([name, path]) => [
      name,
      createHash("sha256")
        .update(readFileSync(resolve(repoRoot, path)))
        .digest("hex"),
    ]),
  );
}

/** Returns the SHAs listed in a blame-ignore file that are not ancestors of `HEAD`. */
function findNonAncestorRevs(revsFile: string): string[] {
  return revsFile
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .filter(
      (sha) =>
        spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: repoRoot }).status !==
        0,
    );
}

function isShallowClone(): boolean {
  return (
    spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim() === "true"
  );
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

  test("skills-lock.json entries match their tracked Module sources byte for byte", () => {
    expect(checkSkillsLock(readLockEntries(), moduleSourceHashes())).toEqual([]);
  });

  test("a lock entry without a Module source fails", () => {
    expect(
      checkSkillsLock({ a: { computedHash: "x" }, b: { computedHash: "y" } }, { a: "x" }),
    ).toEqual(["skills-lock.json lists b but no Module source backs it"]);
  });

  test("a lock entry with a stale hash fails", () => {
    expect(checkSkillsLock({ a: { computedHash: "x" } }, { a: "z" })).toEqual([
      "skills-lock.json hash for a differs from its Module source",
    ]);
  });

  test("a Module skill without a lock entry fails", () => {
    expect(checkSkillsLock({}, { a: "x" })).toEqual([
      "Module skill a has no entry in skills-lock.json",
    ]);
  });

  test.skipIf(isShallowClone())("every .git-blame-ignore-revs SHA is an ancestor of HEAD", () => {
    expect(findNonAncestorRevs(readText(".git-blame-ignore-revs"))).toEqual([]);
  });

  test("a blame-ignore SHA outside history is reported by name", () => {
    const missing = "0000000000000000000000000000000000000001";
    expect(findNonAncestorRevs(`# note\n${missing}\n`)).toEqual([missing]);
  });
});
