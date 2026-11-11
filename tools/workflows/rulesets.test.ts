import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const workflowsDirectory = join(repoRoot, ".github", "workflows");
const rulesetsDirectory = join(repoRoot, ".github", "rulesets");
/** The workflow files the `github-ci` Module writes into a generated Project. */
const moduleWorkflowsDirectory = join(repoRoot, "registry-src", "github-ci", "files", "workflows");
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
export function listCheckNames(text: string): string[] {
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

/** The gating workflows whose every check `develop` and `main` must require besides `CI passed`. */
const gatingWorkflowFiles = [
  "lint-pr.yml",
  "determinism.yml",
  "distribution.yml",
  "codeql.yml",
  "lint-docs.yml",
];

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

/** What a branch ruleset must hold: its ref, its one merge method, and whether history stays linear. */
type BranchPolicy = {
  readonly name: string;
  readonly ref: string;
  readonly mergeMethod: "squash" | "merge";
  /**
   * True on `develop`, which is squash only: linear history and the strict (up to date) policy.
   * False on `main`, where a promotion merge commit is never on `develop`.
   */
  readonly linear: boolean;
};

const developPolicy: BranchPolicy = {
  name: "develop",
  ref: "refs/heads/develop",
  mergeMethod: "squash",
  linear: true,
};
const mainPolicy: BranchPolicy = {
  name: "main",
  ref: "refs/heads/main",
  mergeMethod: "merge",
  linear: false,
};

function readParameters(rule: Record<string, unknown> | undefined): Record<string, unknown> {
  return isRecord(rule?.["parameters"]) ? rule["parameters"] : {};
}

function findTargetProblems(file: string, ruleset: unknown, policy: BranchPolicy): string[] {
  const record = isRecord(ruleset) ? ruleset : {};
  const problems: string[] = [];
  if (
    record["name"] !== policy.name ||
    record["target"] !== "branch" ||
    record["enforcement"] !== "active"
  )
    problems.push(`${file} must be an active branch ruleset named ${policy.name}`);
  const conditions = isRecord(record["conditions"]) ? record["conditions"] : {};
  const refName = isRecord(conditions["ref_name"]) ? conditions["ref_name"] : {};
  const included = JSON.stringify(asArray(refName["include"]));
  const expected = JSON.stringify([policy.ref]);
  if (included !== expected)
    problems.push(`${file} targets ${included}; it must target ${expected} only`);
  if (asArray(refName["exclude"]).length > 0) problems.push(`${file} must exclude no ref`);
  if (!Array.isArray(record["bypass_actors"]) || record["bypass_actors"].length > 0)
    problems.push(`${file} must have no bypass actors`);
  return problems;
}

/** Returns one line per way the branch ruleset in `file` departs from `policy`, each naming the file. */
function findBranchRulesetProblems(file: string, ruleset: unknown, policy: BranchPolicy): string[] {
  const problems = findTargetProblems(file, ruleset, policy);
  for (const type of ["deletion", "non_fast_forward", "required_signatures"]) {
    if (findRule(ruleset, type) === undefined) problems.push(`${file} lacks the ${type} rule`);
  }
  const pullRequest = readParameters(findRule(ruleset, "pull_request"));
  const methods = JSON.stringify(asArray(pullRequest["allowed_merge_methods"]));
  const expectedMethods = JSON.stringify([policy.mergeMethod]);
  if (methods !== expectedMethods)
    problems.push(
      `${file} allows the merge methods ${methods}; it must allow ${expectedMethods} only`,
    );
  if (pullRequest["required_review_thread_resolution"] !== true)
    problems.push(`${file} must require review thread resolution`);
  const hasLinearHistory = findRule(ruleset, "required_linear_history") !== undefined;
  if (policy.linear && !hasLinearHistory) problems.push(`${file} must require linear history`);
  if (!policy.linear && hasLinearHistory)
    problems.push(`${file} requires linear history, which blocks every promotion merge commit`);
  const strict = readParameters(findRule(ruleset, "required_status_checks"))[
    "strict_required_status_checks_policy"
  ];
  if (policy.linear && strict !== true)
    problems.push(`${file} must set the strict required checks policy`);
  if (!policy.linear && strict !== false)
    problems.push(`${file} sets the strict required checks policy, which blocks every promotion`);
  return problems;
}

/** A copy of `ruleset` whose rule of `type` has `parameters` merged over its own. */
function withRuleParameters(
  ruleset: unknown,
  type: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const rules = listRules(ruleset).map((rule) =>
    rule["type"] === type
      ? Object.assign({}, rule, {
          parameters: Object.assign({}, readParameters(rule), parameters),
        })
      : rule,
  );
  return Object.assign({}, isRecord(ruleset) ? ruleset : {}, { rules });
}

function withoutRule(ruleset: unknown, type: string): Record<string, unknown> {
  const rules = listRules(ruleset).filter((rule) => rule["type"] !== type);
  return Object.assign({}, isRecord(ruleset) ? ruleset : {}, { rules });
}

function withRule(ruleset: unknown, rule: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, isRecord(ruleset) ? ruleset : {}, {
    rules: listRules(ruleset).concat([rule]),
  });
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
  const developRuleset = readJson(join(rulesetsDirectory, "develop.json"));
  const mainRuleset = readJson(join(rulesetsDirectory, "main.json"));
  const branchRulesets = [
    { file: "develop.json", ruleset: developRuleset, policy: developPolicy },
    { file: "main.json", ruleset: mainRuleset, policy: mainPolicy },
  ];
  const tagsRuleset = readJson(join(rulesetsDirectory, "tags.json"));

  test("every required check in .github/rulesets equals a real job name", () => {
    const files = readdirSync(rulesetsDirectory).filter((file) => file.endsWith(".json"));
    expect(files.toSorted()).toEqual(["develop.json", "main.json", "tags.json"]);
    const problems = files.flatMap((file) =>
      findRulesetProblems(file, readJson(join(rulesetsDirectory, file)), checkNames),
    );
    expect(problems).toEqual([]);
  });

  test.each(["develop.json", "main.json"])(
    "S1: %p requiring a check that is no workflow job fails, naming the ruleset",
    (file) => {
      const ruleset = readJson(join(rulesetsDirectory, file));
      const broken = withRuleParameters(ruleset, "required_status_checks", {
        required_status_checks: [{ context: "CI passed" }, { context: "ci passed" }],
      });
      expect(findRulesetProblems(file, broken, checkNames)).toEqual([
        `${file} requires check "ci passed" but no workflow job is named that`,
      ]);
    },
  );

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

  test.each(["validate PR title", "Validate PR Title", "check markdown links"])(
    "a required check named %p, differing only in case from a job name, fails",
    (context) => {
      const ruleset = {
        rules: [
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context }] },
          },
        ],
      };
      expect(findRulesetProblems("main.json", ruleset, checkNames)).toEqual([
        `main.json requires check "${context}" but no workflow job is named that`,
      ]);
    },
  );

  test("the workflows report the required names Validate PR title and Check markdown links", () => {
    expect(checkNames.has("Validate PR title")).toBe(true);
    expect(checkNames.has("Check markdown links")).toBe(true);
    expect(checkNames.has(aggregateJobName)).toBe(true);
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

  test.each([
    { file: "develop.json", ruleset: developRuleset },
    { file: "main.json", ruleset: mainRuleset },
  ])("S17: $file requires CI passed and every gating workflow check", ({ ruleset }) => {
    const gatingChecks = gatingWorkflowFiles.flatMap((file) =>
      listCheckNames(readFileSync(join(workflowsDirectory, file), "utf8")),
    );
    expect(gatingChecks).toEqual([
      "Validate PR title",
      "digest (ubuntu-latest)",
      "digest (macos-latest)",
      "compare digests",
      "package and binary (linux-x64)",
      "package and binary (aokit-linux-arm64)",
      "package and binary (aokit-darwin-arm64)",
      "analyze (javascript-typescript)",
      "analyze (actions)",
      "Check markdown links",
    ]);
    expect(listRequiredChecks(ruleset)).toEqual([aggregateJobName, ...gatingChecks]);
  });

  test.each(branchRulesets)(
    "every required check in $file comes from GitHub Actions",
    ({ ruleset }) => {
      const checks = listRules(ruleset)
        .filter((rule) => rule["type"] === "required_status_checks")
        .flatMap((rule) =>
          asArray(isRecord(rule["parameters"]) ? rule["parameters"]["required_status_checks"] : []),
        );
      expect(checks.length).toBeGreaterThan(0);
      for (const check of checks) {
        expect(isRecord(check) && check["integration_id"]).toBe(githubActionsIntegrationId);
      }
    },
  );

  test.each(branchRulesets)(
    "S1: $file targets its branch with its one merge method and the rules of its policy",
    ({ file, ruleset, policy }) => {
      expect(findBranchRulesetProblems(file, ruleset, policy)).toEqual([]);
      expect(findRule(ruleset, "required_signatures")).toEqual({ type: "required_signatures" });
    },
  );

  test.each([[["squash", "merge"]], [["merge"]], [["rebase"]], [[]]])(
    "S1: develop.json allowing the merge methods %j fails, naming the ruleset",
    (methods) => {
      const ruleset = withRuleParameters(developRuleset, "pull_request", {
        allowed_merge_methods: methods,
      });
      expect(findBranchRulesetProblems("develop.json", ruleset, developPolicy)).toEqual([
        `develop.json allows the merge methods ${JSON.stringify(methods)}; it must allow ["squash"] only`,
      ]);
    },
  );

  test.each([[["merge", "squash"]], [["squash"]], [["rebase"]], [[]]])(
    "S1: main.json allowing the merge methods %j fails, naming the ruleset",
    (methods) => {
      const ruleset = withRuleParameters(mainRuleset, "pull_request", {
        allowed_merge_methods: methods,
      });
      expect(findBranchRulesetProblems("main.json", ruleset, mainPolicy)).toEqual([
        `main.json allows the merge methods ${JSON.stringify(methods)}; it must allow ["merge"] only`,
      ]);
    },
  );

  test("S1: main.json still carrying linear history or the strict policy fails", () => {
    const linear = withRule(mainRuleset, { type: "required_linear_history" });
    expect(findBranchRulesetProblems("main.json", linear, mainPolicy)).toEqual([
      "main.json requires linear history, which blocks every promotion merge commit",
    ]);
    const strict = withRuleParameters(mainRuleset, "required_status_checks", {
      strict_required_status_checks_policy: true,
    });
    expect(findBranchRulesetProblems("main.json", strict, mainPolicy)).toEqual([
      "main.json sets the strict required checks policy, which blocks every promotion",
    ]);
  });

  test("S1: develop.json without linear history or the strict policy fails", () => {
    const withoutLinear = withoutRule(developRuleset, "required_linear_history");
    expect(findBranchRulesetProblems("develop.json", withoutLinear, developPolicy)).toEqual([
      "develop.json must require linear history",
    ]);
    const relaxed = withRuleParameters(developRuleset, "required_status_checks", {
      strict_required_status_checks_policy: false,
    });
    expect(findBranchRulesetProblems("develop.json", relaxed, developPolicy)).toEqual([
      "develop.json must set the strict required checks policy",
    ]);
  });

  test.each(["deletion", "non_fast_forward", "required_signatures"])(
    "S1: a branch ruleset without the %p rule fails",
    (type) => {
      expect(
        findBranchRulesetProblems("main.json", withoutRule(mainRuleset, type), mainPolicy),
      ).toEqual([`main.json lacks the ${type} rule`]);
      expect(
        findBranchRulesetProblems("develop.json", withoutRule(developRuleset, type), developPolicy),
      ).toEqual([`develop.json lacks the ${type} rule`]);
    },
  );

  test("S1: a branch ruleset on another ref, inactive or with a bypass actor fails", () => {
    const defaultBranch = Object.assign({}, mainRuleset, {
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    });
    expect(findBranchRulesetProblems("main.json", defaultBranch, mainPolicy)).toEqual([
      'main.json targets ["~DEFAULT_BRANCH"]; it must target ["refs/heads/main"] only',
    ]);
    const excluding = Object.assign({}, developRuleset, {
      conditions: {
        ref_name: { include: ["refs/heads/develop"], exclude: ["refs/heads/develop"] },
      },
    });
    expect(findBranchRulesetProblems("develop.json", excluding, developPolicy)).toEqual([
      "develop.json must exclude no ref",
    ]);
    const bypassed = Object.assign({}, developRuleset, {
      bypass_actors: [
        { actor_id: repositoryAdminRoleId, actor_type: "RepositoryRole", bypass_mode: "always" },
      ],
    });
    expect(findBranchRulesetProblems("develop.json", bypassed, developPolicy)).toEqual([
      "develop.json must have no bypass actors",
    ]);
    const inactive = Object.assign({}, mainRuleset, { enforcement: "evaluate" });
    expect(findBranchRulesetProblems("main.json", inactive, mainPolicy)).toEqual([
      "main.json must be an active branch ruleset named main",
    ]);
  });

  test("S1: a branch ruleset without review thread resolution fails", () => {
    const unresolved = withRuleParameters(developRuleset, "pull_request", {
      required_review_thread_resolution: false,
    });
    expect(findBranchRulesetProblems("develop.json", unresolved, developPolicy)).toEqual([
      "develop.json must require review thread resolution",
    ]);
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

  test("the five triage labels live in Linear and are absent from the GitHub labels", () => {
    expect(triageLabels).toHaveLength(5);
    const names = new Set(labels.map((label) => (isRecord(label) ? label["name"] : undefined)));
    expect(triageLabels.filter((label) => names.has(label))).toEqual([]);
  });
});

function listModuleCheckNames(file: string): string[] {
  return listCheckNames(readFileSync(join(moduleWorkflowsDirectory, file), "utf8"));
}

const moduleCheckNames: readonly { file: string; expected: string[] }[] = [
  { file: "ci.yml", expected: ["check", "Commitlint", aggregateJobName] },
  { file: "labels.yml", expected: ["Sync labels"] },
  { file: "lint-docs.yml", expected: ["Check markdown links"] },
  { file: "lint-pr.yml", expected: ["Validate PR title"] },
  { file: "lint-workflows.yml", expected: ["actionlint + zizmor"] },
];

describe("github-ci Module check names", () => {
  test("the Module's workflows report the check names the standard rulesets require", () => {
    const checkNames = readdirSync(moduleWorkflowsDirectory)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) => listModuleCheckNames(name));
    for (const required of [
      aggregateJobName,
      "Commitlint",
      "Validate PR title",
      "Check markdown links",
    ]) {
      expect(checkNames).toContain(required);
    }
    expect(checkNames).not.toContain("semantic PR title");
  });

  test.each(moduleCheckNames)("$file reports exactly $expected", ({ file, expected }) => {
    expect(listModuleCheckNames(file)).toEqual(expected);
  });
});
