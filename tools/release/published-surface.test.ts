import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const publishedPackages = ["aokit", "create-aokit", "@aokit/module"];
const placeholderPattern = /\b(?:TODO|TBD|FIXME|placeholder|your-package|<package>)\b/i;

function readText(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** The published package names `llms.txt` does not link, as `https://www.npmjs.com/package/<name>`. */
function findUncoveredPackages(llms: string): string[] {
  return publishedPackages.filter(
    (name) => !llms.includes(`](https://www.npmjs.com/package/${name})`),
  );
}

/** The problems in the README's what-it-is heading and its npm badges. */
function findReadmeShapeProblems(readme: string): string[] {
  const problems: string[] = [];
  if (!readme.includes("\n## What it is\n"))
    problems.push('the README has no "What it is" heading');
  for (const kind of ["v", "types"]) {
    const badge = new RegExp(
      `\\[!\\[[^\\]]+\\]\\(https://img\\.shields\\.io/npm/${kind}/aokit\\)\\]\\(https://www\\.npmjs\\.com/package/aokit\\)`,
    );
    if (!badge.test(readme)) problems.push(`the README has no npm ${kind} badge for aokit`);
  }
  const badgeLines = readme.split("\n").filter((line) => line.startsWith("[!["));
  for (const line of badgeLines) {
    if (placeholderPattern.test(line)) problems.push(`placeholder badge: ${line}`);
  }
  return problems;
}

describe("V08: llms.txt covers every published package", () => {
  const llms = readText("llms.txt");

  test("links aokit, create-aokit and @aokit/module", () => {
    expect(findUncoveredPackages(llms)).toEqual([]);
  });

  test("the published names match the package manifests", () => {
    const names = ["aokit", "create-aokit", "module"].map((directory) => {
      const manifest: unknown = JSON.parse(readText(`packages/${directory}/package.json`));
      return typeof manifest === "object" && manifest !== null && "name" in manifest
        ? manifest.name
        : undefined;
    });
    expect(names).toEqual(publishedPackages);
  });

  test("a package missing from llms.txt is reported", () => {
    const without = llms.replace("](https://www.npmjs.com/package/create-aokit)", "](#)");
    expect(findUncoveredPackages(without)).toEqual(["create-aokit"]);
  });
});

describe("C2, C3: README shape", () => {
  const readme = readText("README.md");

  test("has the What it is heading and the npm version and types badges", () => {
    expect(findReadmeShapeProblems(readme)).toEqual([]);
  });

  test("a missing heading or badge is reported", () => {
    const broken = readme.replace("## What it is", "## About").replace("npm/types/aokit", "x");
    expect(findReadmeShapeProblems(broken)).toEqual([
      'the README has no "What it is" heading',
      "the README has no npm types badge for aokit",
    ]);
  });

  test("a placeholder badge is reported", () => {
    const broken = `${readme}\n[![x](https://example.com/TODO.svg)](#)\n`;
    expect(findReadmeShapeProblems(broken)).toEqual([
      "placeholder badge: [![x](https://example.com/TODO.svg)](#)",
    ]);
  });
});
