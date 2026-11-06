import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDirectory = join(repoRoot, ".github", "workflows");
const rulesetsDirectory = join(repoRoot, ".github", "rulesets");
const aggregateJobName = "CI passed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJobs(text: string): Record<string, unknown> {
  const workflow: unknown = Bun.YAML.parse(text);
  return isRecord(workflow) && isRecord(workflow["jobs"]) ? workflow["jobs"] : {};
}

/** The check names a workflow's jobs report: the literal `name:`, or the job id when there is none. */
function listCheckNames(text: string): string[] {
  return Object.entries(parseJobs(text)).flatMap(([id, job]) => {
    const name = isRecord(job) ? job["name"] : undefined;
    if (name === undefined) return [id];
    return typeof name === "string" && !name.includes("${{") ? [name] : [];
  });
}

function readWorkflows(): { file: string; text: string }[] {
  return readdirSync(workflowsDirectory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => ({ file, text: readFileSync(join(workflowsDirectory, file), "utf8") }));
}

function listRules(ruleset: unknown): Record<string, unknown>[] {
  return isRecord(ruleset) ? asArray(ruleset["rules"]).filter(isRecord) : [];
}

function findRule(ruleset: unknown, type: string): Record<string, unknown> | undefined {
  return listRules(ruleset).find((rule) => rule["type"] === type);
}

function listRequiredChecks(ruleset: unknown): string[] {
  return listRules(ruleset)
    .filter((rule) => rule["type"] === "required_status_checks")
    .flatMap((rule) => {
      const parameters = isRecord(rule["parameters"]) ? rule["parameters"] : {};
      return asArray(parameters["required_status_checks"]).filter(isRecord);
    })
    .map((check) => check["context"])
    .filter((context): context is string => typeof context === "string");
}

/** Returns one line per required check in `ruleset` that no workflow job reports. */
function findRulesetProblems(
  file: string,
  ruleset: unknown,
  checkNames: ReadonlySet<string>,
): string[] {
  return listRequiredChecks(ruleset)
    .filter((context) => !checkNames.has(context))
    .map((context) => `${file} requires check "${context}" but no workflow job is named that`);
}

/** Returns one line per way the `CI passed` job in `ci.yml` fails to gate every other CI job. */
function findAggregateJobProblems(text: string): string[] {
  const jobs = parseJobs(text);
  const entry = Object.entries(jobs).find(
    ([, job]) => isRecord(job) && job["name"] === aggregateJobName,
  );
  if (entry === undefined) return [`ci.yml has no job named "${aggregateJobName}"`];
  const [aggregateId, aggregate] = entry;
  if (!isRecord(aggregate)) return [`ci.yml:${aggregateId} is not a job mapping`];
  const problems: string[] = [];
  if (aggregate["if"] !== "always()")
    problems.push(`ci.yml:${aggregateId} must run with if: always()`);
  const rawNeeds = aggregate["needs"];
  const needs = new Set(typeof rawNeeds === "string" ? [rawNeeds] : asArray(rawNeeds));
  for (const id of Object.keys(jobs)) {
    if (id !== aggregateId && !needs.has(id))
      problems.push(`ci.yml:${aggregateId} does not need ${id}`);
  }
  const scripts = asArray(aggregate["steps"])
    .filter(isRecord)
    .map((step) => step["run"])
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  for (const result of ["failure", "cancelled"]) {
    if (!scripts.includes(result))
      problems.push(`ci.yml:${aggregateId} does not fail on ${result}`);
  }
  return problems;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const ciText = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");

describe("S9: CI passed aggregate job", () => {
  test("ci.yml has a CI passed job that needs every CI job and fails on failure or cancelled", () => {
    expect(findAggregateJobProblems(ciText)).toEqual([]);
  });

  test("a CI job missing from needs fails", () => {
    const text = ciText.replace(
      "  ci-passed:\n",
      "  lint:\n    name: lint\n    runs-on: ubuntu-latest\n  ci-passed:\n",
    );
    expect(findAggregateJobProblems(text)).toEqual(["ci.yml:ci-passed does not need lint"]);
  });

  test("an aggregate job without if: always() fails", () => {
    const text = ciText.replace("    if: always()\n", "");
    expect(findAggregateJobProblems(text)).toEqual(["ci.yml:ci-passed must run with if: always()"]);
  });

  test("an aggregate job that ignores cancelled fails", () => {
    const text = ciText.replace(` | *" cancelled "*`, "");
    expect(findAggregateJobProblems(text)).toEqual(["ci.yml:ci-passed does not fail on cancelled"]);
  });
});

describe("S9: rulesets", () => {
  const checkNames = new Set(readWorkflows().flatMap(({ text }) => listCheckNames(text)));
  const mainRuleset = readJson(join(rulesetsDirectory, "main.json"));
  const tagsRuleset = readJson(join(rulesetsDirectory, "tags.json"));

  test("every required check in .github/rulesets equals a real job name", () => {
    const files = readdirSync(rulesetsDirectory).filter((file) => file.endsWith(".json"));
    expect(files.toSorted()).toEqual(["main.json", "tags.json"]);
    const problems = files.flatMap((file) =>
      findRulesetProblems(file, readJson(join(rulesetsDirectory, file)), checkNames),
    );
    expect(problems).toEqual([]);
  });

  test("a ruleset requiring a check no job provides fails", () => {
    const ruleset = {
      rules: [
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "CI passed" }, { context: "lint" }] },
        },
      ],
    };
    expect(findRulesetProblems("main.json", ruleset, checkNames)).toEqual([
      'main.json requires check "lint" but no workflow job is named that',
    ]);
  });

  test("main requires CI passed, squash merges, linear history and blocks force pushes and deletion", () => {
    expect(isRecord(mainRuleset) && mainRuleset["target"]).toBe("branch");
    expect(listRequiredChecks(mainRuleset)).toEqual([aggregateJobName]);
    const pullRequest = findRule(mainRuleset, "pull_request");
    expect(
      isRecord(pullRequest?.["parameters"]) && pullRequest["parameters"]["allowed_merge_methods"],
    ).toEqual(["squash"]);
    for (const type of ["required_linear_history", "non_fast_forward", "deletion"]) {
      expect(findRule(mainRuleset, type)).toBeDefined();
    }
  });

  test("tags cannot be updated or deleted", () => {
    expect(isRecord(tagsRuleset) && tagsRuleset["target"]).toBe("tag");
    expect(findRule(tagsRuleset, "update")).toBeDefined();
    expect(findRule(tagsRuleset, "deletion")).toBeDefined();
  });
});

describe("S9: labels", () => {
  const labels = asArray(
    Bun.YAML.parse(readFileSync(join(repoRoot, ".github", "labels.yml"), "utf8")),
  );
  const triageDoc = readFileSync(join(repoRoot, "docs", "agents", "triage-labels.md"), "utf8");
  const triageLabels = [...triageDoc.matchAll(/^\| `([a-z-]+)`/gm)].map((match) => match[1]);

  test("every label has a name, a six-digit hex color and a description, with unique names", () => {
    const problems = labels.flatMap((label, index) => {
      if (!isRecord(label)) return [`entry ${index + 1} is not a mapping`];
      const { name, color, description } = label;
      const entryProblems: string[] = [];
      if (typeof name !== "string" || name === "")
        entryProblems.push(`entry ${index + 1} has no name`);
      if (typeof color !== "string" || !/^[0-9a-f]{6}$/.test(color))
        entryProblems.push(`entry ${index + 1} has no six-digit hex color`);
      if (typeof description !== "string" || description === "")
        entryProblems.push(`entry ${index + 1} has no description`);
      return entryProblems;
    });
    expect(problems).toEqual([]);
    const names = labels.map((label) => (isRecord(label) ? label["name"] : undefined));
    expect(new Set(names).size).toBe(names.length);
  });

  test("the five triage labels are present", () => {
    expect(triageLabels).toHaveLength(5);
    const names = new Set(labels.map((label) => (isRecord(label) ? label["name"] : undefined)));
    expect(triageLabels.filter((label) => !names.has(label))).toEqual([]);
  });
});
