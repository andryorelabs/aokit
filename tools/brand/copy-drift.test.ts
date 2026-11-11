import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const AUTHOR = "Andry Orellana <hello@andryore.dev>";
const CREDIT_LINE = "Built by [AndryOre](https://andryore.dev)";

type PackageManifest = Readonly<Record<string, unknown>>;

function parseManifest(raw: string): PackageManifest {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("package.json is not an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function readText(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

/**
 * Returns the first fenced block that follows the given `##` heading of
 * `docs/brand/copy.md`.
 */
function copyBlock(copy: string, heading: string): string {
  const start = copy.indexOf(`\n## ${heading}\n`);
  if (start === -1) {
    throw new Error(`docs/brand/copy.md has no "${heading}" section`);
  }
  const match = /```text\n([\s\S]*?)\n```/.exec(copy.slice(start + 1));
  if (match?.[1] === undefined) {
    throw new Error(`docs/brand/copy.md "${heading}" has no text block`);
  }
  return match[1];
}

/** Maps each package name of the "Package metadata" table to its description. */
function packageDescriptions(copy: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const line of copy.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const name = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (name !== undefined && cells[2] !== undefined && cells[2] !== "") {
      descriptions.set(name, cells[2]);
    }
  }
  return descriptions;
}

/** Returns the problems found when the README and manifests drift from the copy. */
function findCopyDrift(files: {
  readonly copy: string;
  readonly readme: string;
  readonly manifests: Readonly<Record<string, string>>;
}): string[] {
  const problems: string[] = [];
  const slogan = copyBlock(files.copy, "Brand line");
  if (!files.readme.includes(`<strong>${slogan}</strong>`)) {
    problems.push(`README.md: slogan differs from docs/brand/copy.md "${slogan}"`);
  }
  const descriptions = packageDescriptions(files.copy);
  for (const [path, raw] of Object.entries(files.manifests)) {
    const manifest = parseManifest(raw);
    const name = String(manifest["name"]);
    const expected = descriptions.get(name);
    if (expected === undefined) {
      problems.push(`${path}: ${name} is missing from docs/brand/copy.md`);
    } else if (manifest.description !== expected) {
      problems.push(`${path}: description differs from docs/brand/copy.md "${expected}"`);
    }
  }
  return problems;
}

const MANIFEST_PATHS = [
  "packages/aokit/package.json",
  "packages/create-aokit/package.json",
  "packages/module/package.json",
];

describe("copy drift", () => {
  test("the README and package descriptions match docs/brand/copy.md", () => {
    const manifests = Object.fromEntries(MANIFEST_PATHS.map((path) => [path, readText(path)]));
    expect(
      findCopyDrift({
        copy: readText("docs/brand/copy.md"),
        readme: readText("README.md"),
        manifests,
      }),
    ).toEqual([]);
  });

  test("a changed package description is reported with its file", () => {
    const copy = readText("docs/brand/copy.md");
    const path = MANIFEST_PATHS[0] ?? "";
    const manifest = parseManifest(readText(path));
    const changed = JSON.stringify({ ...manifest, description: "Something else." });
    const problems = findCopyDrift({
      copy,
      readme: readText("README.md"),
      manifests: { [path]: changed },
    });
    expect(problems).toHaveLength(1);
    expect(problems.join("\n")).toContain(`${path}: description differs`);
  });

  test("a changed README slogan is reported", () => {
    const copy = readText("docs/brand/copy.md");
    const readme = readText("README.md").replace("Updates that merge.", "Updates.");
    const problems = findCopyDrift({ copy, readme, manifests: {} });
    expect(problems).toHaveLength(1);
    expect(problems.join("\n")).toContain("README.md: slogan differs");
  });
});

describe("README shape", () => {
  const readme = readText("README.md");

  test("opens with the H1 and the cover, then the slogan, badges and links line", () => {
    const order = [
      "# aokit\n",
      "<picture>",
      "<strong>",
      "[![CI]",
      "[![Release]",
      "[![License",
      "[![OpenSSF",
      "[Documentation](docs/README.md) ·",
    ];
    const positions = order.map((marker) => readme.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });

  test("keeps the required sections in order", () => {
    const required = ["Quickstart", "How it works", "Documentation", "Contributing", "License"];
    const headings = readme
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    expect(headings.filter((heading) => required.includes(heading))).toEqual(required);
  });

  test("has a License heading and ends with the credit line", () => {
    expect(readme).toContain("\n## License\n");
    expect(readme).not.toContain("## Licence");
    expect(readme.trimEnd().split("\n").at(-1)).toBe(CREDIT_LINE);
  });
});

describe("package manifests", () => {
  test.each(MANIFEST_PATHS)("%s has the six metadata fields", (path) => {
    const manifest = parseManifest(readText(path));
    expect(manifest["description"]).toBeTruthy();
    expect(manifest["license"]).toBe("MIT");
    expect(manifest["author"]).toBe(AUTHOR);
    expect(manifest["homepage"]).toBe("https://github.com/andryorelabs/aokit#readme");
    expect(manifest["repository"]).toBeTruthy();
    expect(manifest["bugs"]).toBeTruthy();
  });
});
