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
    expect(formFileNames).toContain("bug_report.yml");
    expect(formFileNames).toContain("feature_request.yml");
  });

  for (const formFileName of formFileNames) {
    test(`${formFileName} is a valid issue form`, () => {
      const formSource = readFileSync(join(issueTemplateDirectory, formFileName), "utf8");
      expect(findFormProblems(formSource)).toEqual([]);
    });
  }

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
});
