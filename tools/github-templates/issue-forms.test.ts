import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const issueTemplateDirectory = join(import.meta.dir, "..", "..", ".github", "ISSUE_TEMPLATE");

/**
 * Reads one field from a parsed YAML value, or `undefined` when the value is
 * not an object.
 */
function readField(parsedValue: unknown, fieldName: string): unknown {
  if (typeof parsedValue !== "object" || parsedValue === null) {
    return undefined;
  }
  return Reflect.get(parsedValue, fieldName);
}

/**
 * Parses an issue form and returns the problems that stop GitHub from
 * rendering it: invalid YAML, or a missing `name` or `body`.
 */
function findFormProblems(formSource: string): string[] {
  let parsedForm: unknown;
  try {
    parsedForm = Bun.YAML.parse(formSource);
  } catch (error) {
    return [`invalid YAML: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (typeof parsedForm !== "object" || parsedForm === null) {
    return ["form is not a YAML mapping"];
  }
  const problems: string[] = [];
  const formName = readField(parsedForm, "name");
  if (typeof formName !== "string" || formName.trim() === "") {
    problems.push("missing name");
  }
  const formBody = readField(parsedForm, "body");
  if (!Array.isArray(formBody) || formBody.length === 0) {
    problems.push("missing body");
  }
  return problems;
}

const repositoryRoot = join(import.meta.dir, "..", "..");

/**
 * Reads the label names declared in `.github/labels.yml`.
 */
function readDeclaredLabelNames(): string[] {
  const parsedLabels: unknown = Bun.YAML.parse(
    readFileSync(join(repositoryRoot, ".github", "labels.yml"), "utf8"),
  );
  if (!Array.isArray(parsedLabels)) {
    throw new Error(".github/labels.yml must be a list");
  }
  return parsedLabels.map((label: unknown) => String(readField(label, "name")));
}

/**
 * Returns the labels in `referencedLabels` that `declaredLabels` does not contain.
 */
function findMissingLabels(referencedLabels: string[], declaredLabels: string[]): string[] {
  return referencedLabels.filter((label) => !declaredLabels.includes(label));
}

describe("findMissingLabels", () => {
  test("names a referenced label that is not declared", () => {
    expect(findMissingLabels(["Type: Bug", "Type: Nope"], ["Type: Bug"])).toEqual(["Type: Nope"]);
  });

  test("accepts labels that are all declared", () => {
    expect(findMissingLabels(["Type: Bug"], ["Type: Bug", "Area: cli"])).toEqual([]);
  });
});

describe("pull request template", () => {
  const template = readFileSync(
    join(repositoryRoot, ".github", "PULL_REQUEST_TEMPLATE.md"),
    "utf8",
  );

  test("has the five sections", () => {
    for (const heading of [
      "## Description",
      "## Related issue",
      "## Type of change",
      "## Breaking change",
      "## Checklist",
    ]) {
      expect(template).toContain(heading);
    }
  });

  test("states the title format", () => {
    expect(template).toContain("type: <gitmoji> lowercase subject");
  });
});

describe("findFormProblems", () => {
  test("accepts a form with name and body", () => {
    expect(
      findFormProblems("name: Bug\nbody:\n  - type: markdown\n    attributes:\n      value: x\n"),
    ).toEqual([]);
  });

  test("rejects invalid YAML", () => {
    expect(findFormProblems("name: [unclosed\nbody: {")).toHaveLength(1);
  });

  test("rejects a form without name", () => {
    expect(findFormProblems("body:\n  - type: markdown\n")).toEqual(["missing name"]);
  });

  test("rejects a form without body", () => {
    expect(findFormProblems("name: Bug\n")).toEqual(["missing body"]);
  });
});

describe("issue forms in .github/ISSUE_TEMPLATE", () => {
  const formFileNames = readdirSync(issueTemplateDirectory).filter(
    (fileName) => fileName.endsWith(".yml") && fileName !== "config.yml",
  );

  test("includes the bug report and feature request forms", () => {
    expect(formFileNames).toContain("1-bug-report.yml");
    expect(formFileNames).toContain("2-feature-request.yml");
  });

  for (const formFileName of formFileNames) {
    test(`${formFileName} is a valid issue form`, () => {
      const formSource = readFileSync(join(issueTemplateDirectory, formFileName), "utf8");
      expect(findFormProblems(formSource)).toEqual([]);
    });
  }

  const expectedLabelsByForm: Record<string, string[]> = {
    "1-bug-report.yml": ["Type: Bug"],
    "2-feature-request.yml": ["Type: Feature"],
    "3-enhancement-request.yml": ["Type: Enhancement"],
    "4-documentation-bug.yml": ["Type: Docs"],
  };

  for (const [formFileName, expectedLabels] of Object.entries(expectedLabelsByForm)) {
    test(`${formFileName} applies ${expectedLabels.join(", ")}`, () => {
      const form: unknown = Bun.YAML.parse(
        readFileSync(join(issueTemplateDirectory, formFileName), "utf8"),
      );
      expect(readField(form, "labels")).toEqual(expectedLabels);
    });
  }

  test("every form label exists in labels.yml", () => {
    const declaredLabels = readDeclaredLabelNames();
    const formLabels = formFileNames.flatMap((fileName) => {
      const form: unknown = Bun.YAML.parse(
        readFileSync(join(issueTemplateDirectory, fileName), "utf8"),
      );
      const labels = readField(form, "labels");
      return Array.isArray(labels) ? labels.map(String) : [];
    });
    expect(findMissingLabels(formLabels, declaredLabels)).toEqual([]);
  });

  test("labels.yml holds exactly the standard label set plus the Area labels", () => {
    const standardLabels = [
      "Type: Bug",
      "Type: Feature",
      "Type: Enhancement",
      "Type: Docs",
      "Type: Security",
      "Status: Needs Info",
      "Status: Needs Decision",
      "Status: Blocked",
      "Status: In Progress",
      "Priority: Critical",
      "Priority: High",
      "Priority: Medium",
      "Priority: Low",
      "Resolution: Duplicate",
      "Resolution: Won't Fix",
      "Resolution: Invalid",
      "dependencies",
      "github-actions",
      "security",
      "breaking-change",
      "good first issue",
      "help wanted",
    ];
    const areaLabels = ["Area: cli", "Area: module", "Area: registry", "Area: ci", "Area: docs"];
    expect(readDeclaredLabelNames().toSorted()).toEqual(
      [...standardLabels, ...areaLabels].toSorted(),
    );
  });

  test("every label has a color and a description", () => {
    const parsedLabels: unknown = Bun.YAML.parse(
      readFileSync(join(repositoryRoot, ".github", "labels.yml"), "utf8"),
    );
    for (const label of Array.isArray(parsedLabels) ? parsedLabels : []) {
      expect(String(readField(label, "color"))).toMatch(/^[0-9a-f]{6}$/);
      expect(String(readField(label, "description")).length).toBeGreaterThan(0);
    }
  });

  test("every Renovate label exists in labels.yml", () => {
    const renovateSource = readFileSync(join(repositoryRoot, "renovate.json5"), "utf8");
    const renovateLabels = [
      ...renovateSource.matchAll(/(?:labels|addLabels): \[([^\]]*)\]/g),
    ].flatMap((match) =>
      [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((quoted) => quoted[1] ?? ""),
    );
    expect(renovateLabels.length).toBeGreaterThan(0);
    expect(findMissingLabels(renovateLabels, readDeclaredLabelNames())).toEqual([]);
  });

  test("config.yml disables blank issues and routes security reports", () => {
    const configSource = readFileSync(join(issueTemplateDirectory, "config.yml"), "utf8");
    const config: unknown = Bun.YAML.parse(configSource);
    const contactLinks = readField(config, "contact_links");
    expect(readField(config, "blank_issues_enabled")).toBe(false);
    expect(Array.isArray(contactLinks)).toBe(true);
    expect(
      Array.isArray(contactLinks) &&
        contactLinks.some((link: unknown) => {
          const linkUrl = readField(link, "url");
          return typeof linkUrl === "string" && linkUrl.endsWith("/security/advisories/new");
        }),
    ).toBe(true);
  });

  test("config.yml has a Support/Docs contact link next to the security link", () => {
    const config: unknown = Bun.YAML.parse(
      readFileSync(join(issueTemplateDirectory, "config.yml"), "utf8"),
    );
    const contactLinks = readField(config, "contact_links");
    const linkNames = Array.isArray(contactLinks)
      ? contactLinks.map((link: unknown) => String(readField(link, "name")))
      : [];
    expect(linkNames.some((name) => /support|docs|documentation/i.test(name))).toBe(true);
  });
});
