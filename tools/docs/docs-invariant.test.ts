import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { githubSlug, headingSlugs } from "./slug";

const repoRoot = resolve(import.meta.dir, "../..");

const requiredHeaderLines = ["Status:", "Spec:", "Architecture:"];
const requiredSections = ["Context", "Decision", "Consequences", "Alternatives considered"];

function listMarkdown(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdown(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

function adrFileNames(root: string): string[] {
  return readdirSync(join(root, "docs/adr")).filter((name) => /^\d{4}-.+\.md$/.test(name));
}

function checkAdrIndex(root: string): string[] {
  const adrDirectory = join(root, "docs/adr");
  const index = readFileSync(join(adrDirectory, "README.md"), "utf8");
  const listed = [...index.matchAll(/\]\((\d{4}-[^)#\s]+\.md)\)/g)].map((match) => match[1] ?? "");
  const problems: string[] = [];
  for (const file of adrFileNames(root)) {
    if (!listed.includes(file))
      problems.push(`docs/adr/${file} is not listed in docs/adr/README.md`);
  }
  for (const file of listed) {
    if (!existsSync(join(adrDirectory, file))) {
      problems.push(`docs/adr/README.md lists ${file} but the file does not exist`);
    }
  }
  return problems;
}

function checkAdrStructure(root: string): string[] {
  const problems: string[] = [];
  for (const name of adrFileNames(root)) {
    const lines = readFileSync(join(root, "docs/adr", name), "utf8").split("\n");
    for (const header of requiredHeaderLines) {
      if (!lines.some((line) => line.startsWith(header))) {
        problems.push(`docs/adr/${name} is missing the "${header}" line`);
      }
    }
    for (const section of requiredSections) {
      if (!lines.some((line) => line.trimEnd() === `## ${section}`)) {
        problems.push(`docs/adr/${name} is missing the "## ${section}" section`);
      }
    }
  }
  return problems;
}

function stripCode(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line.replace(/`[^`]*`/g, "");
    })
    .join("\n");
}

function checkLinks(root: string): string[] {
  const files = [
    ...listMarkdown(join(root, "docs")),
    ...["README.md", "GLOSSARY.md"]
      .map((name) => join(root, name))
      .filter((path) => existsSync(path)),
  ];
  const problems: string[] = [];
  for (const file of files) {
    const shown = relative(root, file);
    const text = stripCode(readFileSync(file, "utf8"));
    for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = match[1] ?? "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const hashIndex = target.indexOf("#");
      const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? "" : decodeURIComponent(target.slice(hashIndex + 1));
      const resolved = pathPart === "" ? file : resolve(dirname(file), pathPart);
      if (!existsSync(resolved)) {
        problems.push(`${shown}: link "${target}" points to a missing file`);
        continue;
      }
      if (anchor !== "" && resolved.endsWith(".md")) {
        if (!headingSlugs(readFileSync(resolved, "utf8")).has(anchor)) {
          problems.push(`${shown}: link "${target}" points to a missing heading`);
        }
      }
    }
  }
  return problems;
}

function writeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-invariant-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const validAdr = [
  "# 0001. Title",
  "",
  "Status: Accepted",
  "Spec: S1",
  "Architecture: x",
  "",
  "## Context",
  "## Decision",
  "## Consequences",
  "## Alternatives considered",
  "",
].join("\n");

describe("githubSlug", () => {
  test("follows GitHub rules", () => {
    expect(githubSlug("Layout migrate")).toBe("layout-migrate");
    expect(githubSlug("`update --abort`: the marker, v2.0!")).toBe("update---abort-the-marker-v20");
    expect(githubSlug("The merge procedure")).toBe("the-merge-procedure");
    expect(githubSlug("`remove <module>`")).toBe("remove-module");
    expect(githubSlug("snake_case & [link](x.md)")).toBe("snake_case--link");
  });

  test("duplicate headings get numeric suffixes", () => {
    expect([...headingSlugs("# A\n## A\n```\n# no\n```\n## `A`\n")]).toEqual(["a", "a-1", "a-2"]);
  });
});

describe("docs invariants on the repository", () => {
  test("ADR index lists every ADR and only existing files", () => {
    expect(checkAdrIndex(repoRoot)).toEqual([]);
  });

  test("every ADR has the required header lines and sections", () => {
    expect(checkAdrStructure(repoRoot)).toEqual([]);
  });

  test("every relative Markdown link resolves to a file and heading", () => {
    expect(checkLinks(repoRoot)).toEqual([]);
  });
});

describe("docs invariants reject violations", () => {
  test("unlisted ADR names the file", () => {
    const root = writeTree({
      "docs/adr/README.md": "[a](0001-a.md)\n",
      "docs/adr/0001-a.md": validAdr,
      "docs/adr/0002-b.md": validAdr,
    });
    expect(checkAdrIndex(root)).toEqual(["docs/adr/0002-b.md is not listed in docs/adr/README.md"]);
  });

  test("listed missing ADR names the file", () => {
    const root = writeTree({ "docs/adr/README.md": "[a](0009-gone.md)\n" });
    expect(checkAdrIndex(root)).toEqual([
      "docs/adr/README.md lists 0009-gone.md but the file does not exist",
    ]);
  });

  test("missing header line and section name the ADR", () => {
    const root = writeTree({
      "docs/adr/0001-a.md": validAdr
        .replace("Spec: S1\n", "")
        .replace("## Alternatives considered\n", ""),
    });
    expect(checkAdrStructure(root)).toEqual([
      'docs/adr/0001-a.md is missing the "Spec:" line',
      'docs/adr/0001-a.md is missing the "## Alternatives considered" section',
    ]);
  });

  test("broken file link names the file and the link", () => {
    const root = writeTree({ "README.md": "[x](docs/nope.md)\n", "docs/a.md": "# A\n" });
    expect(checkLinks(root)).toEqual(['README.md: link "docs/nope.md" points to a missing file']);
  });

  test("broken anchor names the file and the link", () => {
    const root = writeTree({
      "README.md":
        "[x](docs/a.md#missing) [ok](docs/a.md#the-merge-procedure) [self](#top)\n\n# Top\n",
      "docs/a.md": "# A\n## The `merge` procedure\n",
    });
    expect(checkLinks(root)).toEqual([
      'README.md: link "docs/a.md#missing" points to a missing heading',
    ]);
  });

  test("links inside code are ignored", () => {
    const root = writeTree({ "README.md": "`[x](nope.md)`\n```\n[y](nope.md)\n```\n" });
    expect(checkLinks(root)).toEqual([]);
  });
});
