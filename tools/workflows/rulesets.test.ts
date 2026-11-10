import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDirectory = join(repoRoot, ".github", "workflows");
const rulesetsDirectory = join(repoRoot, ".github", "rulesets");
const aggregateJobName = "CI passed";
const githubActionsIntegrationId = 15368;
const repositoryAdminRoleId = 5;

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

/** The matrix combinations of a job: the product of its list keys, then each `include` entry. */
function listMatrixCombinations(job: Record<string, unknown>): Record<string, unknown>[] {
  const strategy = job["strategy"];
  const matrix = isRecord(strategy) ? strategy["matrix"] : undefined;
  if (!isRecord(matrix)) return [{}];
  const listedKeys = Object.entries(matrix).filter(
    ([key]) => key !== "include" && key !== "exclude",
  );
  let product: Record<string, unknown>[] = listedKeys.length === 0 ? [] : [{}];
  for (const [key, values] of listedKeys) {
    const next: Record<string, unknown>[] = [];
    for (const combination of product) {
      for (const value of asArray(values))
        next.push(Object.assign({}, combination, { [key]: value }));
    }
    product = next;
  }
  return product.concat(asArray(matrix["include"]).filter(isRecord));
}

/**
 * The check names a workflow's jobs report: the literal `name:` with each `${{ matrix.<key> }}`
 * expanded per matrix combination, or the job id when there is none. A name with any other
 * expression is left out, since its value is only known at run time.
 */
function listCheckNames(text: string): string[] {
  return Object.entries(parseJobs(text)).flatMap(([id, job]) => {
    if (!isRecord(job)) return [];
    const name = job["name"];
    if (name === undefined) return [id];
    if (typeof name !== "string") return [];
    const expanded = listMatrixCombinations(job).map((combination) =>
      name.replaceAll(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (expression, key: string) => {
        const value = combination[key];
        return typeof value === "string" ? value : expression;
      }),
    );
    return Array.from(new Set(expanded.filter((checkName) => !checkName.includes("${{"))));
  });
}

/** The gating workflows whose every check `main` must require besides `CI passed`. */
const gatingWorkflowFiles = ["determinism.yml", "distribution.yml", "codeql.yml", "lint-docs.yml"];

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
  const readResults = new Set(
    asArray(aggregate["steps"])
      .filter(isRecord)
      .flatMap((step) => {
        const rawScript = step["run"];
        const env = step["env"];
        if (typeof rawScript !== "string" || !isRecord(env)) return [];
        const script = rawScript
          .split("\n")
          .filter((line) => !/^\s*echo\b/.test(line))
          .join("\n");
        return Object.entries(env)
          .filter(([name]) => new RegExp(`\\$(?:${name}\\b|\\{${name}[}:\\-+=?#%/])`).test(script))
          .map(([, value]) => value);
      })
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) =>
        [...value.matchAll(/\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/g)].map((match) => match[1]),
      ),
  );
  for (const id of needs) {
    if (typeof id === "string" && !readResults.has(id))
      problems.push(`ci.yml:${aggregateId} does not check ${id}`);
  }
  return problems;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const ciText = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");

describe("S9: CI passed aggregate job", () => {
  test("ci.yml has a CI passed job that needs every CI job and checks each result", () => {
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

  test("an env result the gate script never uses does not count as checked", () => {
    const text = ciText.replace('[ "$TEST_RESULT" = success ] || exit 1\n', "");
    expect(findAggregateJobProblems(text)).toEqual(["ci.yml:ci-passed does not check test"]);
  });

  test("an aggregate job that does not read a needed job result fails", () => {
    const text = ciText.replace("          TEST_RESULT: ${{ needs.test.result }}\n", "");
    expect(findAggregateJobProblems(text)).toEqual(["ci.yml:ci-passed does not check test"]);
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

  test("a matrix job name expands to one check per matrix combination", () => {
    const text = [
      "jobs:",
      "  digest:",
      "    name: digest (${{ matrix.os }})",
      "    strategy:",
      "      matrix:",
      "        os: [ubuntu-latest, macos-latest]",
      "        include:",
      "          - os: windows-latest",
      "  arm64:",
      "    name: binary (${{ matrix.artifact }})",
      "    strategy:",
      "      matrix:",
      "        include:",
      "          - artifact: linux-arm64",
      "          - artifact: darwin-arm64",
      "  dynamic:",
      "    name: build (${{ github.ref }})",
      "  plain:",
      "    runs-on: ubuntu-latest",
    ].join("\n");
    expect(listCheckNames(text)).toEqual([
      "digest (ubuntu-latest)",
      "digest (macos-latest)",
      "digest (windows-latest)",
      "binary (linux-arm64)",
      "binary (darwin-arm64)",
      "plain",
    ]);
  });

  test("S17: main requires CI passed and every determinism, distribution, CodeQL and lint-docs check", () => {
    const gatingChecks = gatingWorkflowFiles.flatMap((file) =>
      listCheckNames(readFileSync(join(workflowsDirectory, file), "utf8")),
    );
    expect(gatingChecks).toEqual([
      "digest (ubuntu-latest)",
      "digest (macos-latest)",
      "compare digests",
      "package and binary (linux-x64)",
      "package and binary (aokit-linux-arm64)",
      "package and binary (aokit-darwin-arm64)",
      "analyze (javascript-typescript)",
      "analyze (actions)",
      "docs links",
    ]);
    expect(listRequiredChecks(mainRuleset)).toEqual([aggregateJobName, ...gatingChecks]);
  });

  test("every required check on main comes from GitHub Actions", () => {
    const checks = listRules(mainRuleset)
      .filter((rule) => rule["type"] === "required_status_checks")
      .flatMap((rule) =>
        asArray(isRecord(rule["parameters"]) ? rule["parameters"]["required_status_checks"] : []),
      );
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(isRecord(check) && check["integration_id"]).toBe(githubActionsIntegrationId);
    }
  });

  test("main requires squash merges, linear history and blocks force pushes and deletion", () => {
    expect(isRecord(mainRuleset) && mainRuleset["target"]).toBe("branch");
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

  test("S17: only repository admins can create v* tags", () => {
    expect(findRule(tagsRuleset, "creation")).toBeDefined();
    const conditions = isRecord(tagsRuleset) ? tagsRuleset["conditions"] : undefined;
    const refName = isRecord(conditions) ? conditions["ref_name"] : undefined;
    const included = isRecord(refName) ? asArray(refName["include"]) : [];
    const excluded = isRecord(refName) ? asArray(refName["exclude"]) : [];
    expect(included.some((pattern) => pattern === "~ALL" || pattern === "refs/tags/v*")).toBe(true);
    expect(excluded).toEqual([]);
    expect(isRecord(tagsRuleset) && tagsRuleset["bypass_actors"]).toEqual([
      { actor_id: repositoryAdminRoleId, actor_type: "RepositoryRole", bypass_mode: "always" },
    ]);
  });
});

describe("S19: CI test lanes", () => {
  const testJob = parseJobs(ciText)["test"];
  const job = isRecord(testJob) ? testJob : {};
  const steps = asArray(job["steps"]).filter(isRecord);

  test("the Windows lane runs the packages and tools tests", () => {
    const windowsRuns = steps
      .filter((step) => step["if"] === "runner.os == 'Windows'")
      .map((step) => step["run"]);
    expect(windowsRuns).toContain("bun test packages tools");
    expect(listMatrixCombinations(job)).toContainEqual({ os: "windows-latest", bun: "pinned" });
  });

  test("a non-blocking lane runs the tests on the latest Bun next to the pinned one", () => {
    const combinations = listMatrixCombinations(job);
    expect(combinations).toContainEqual({ os: "ubuntu-latest", bun: "pinned" });
    expect(combinations).toContainEqual({ os: "ubuntu-latest", bun: "latest" });
    expect(job["continue-on-error"]).toBe(
      "${{ matrix.bun == 'latest' || matrix.os == 'windows-latest' }}",
    );
    const setupBun = steps.filter(
      (step) => typeof step["uses"] === "string" && step["uses"].startsWith("oven-sh/setup-bun@"),
    );
    expect(setupBun.map((step) => [step["if"], step["with"]])).toEqual([
      ["matrix.bun == 'pinned'", { "bun-version-file": "package.json" }],
      ["matrix.bun == 'latest'", { "bun-version": "latest" }],
    ]);
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
