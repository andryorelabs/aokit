import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDirectory = join(import.meta.dir, "..", "..", ".github", "workflows");

/** The S8 hardening rules; every problem names exactly one of them. */
type WorkflowRule =
  | "timeout-minutes"
  | "persist-credentials"
  | "permissions"
  | "no-pull-request-target"
  | "concurrency"
  | "no-expression-in-run"
  | "pinned-actions"
  | "node-version-file"
  | "bun-cache"
  | "no-cache-on-release";

/** The job slot used for problems that belong to the whole workflow rather than one job. */
const workflowScope = "(workflow)";
const pinnedReference = /^[^@\s]+@[0-9a-f]{40}$/;
const exactVersionComment = /^v\d+\.\d+\.\d+$/;
const usesLine = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S.*?))?\s*$/;
const jobKeyLine = /^ {2}([A-Za-z0-9_-]+):/;
const topLevelLine = /^\S/;
const readOnlyLevels = new Set(["read", "none"]);
const installCommand = /\bbun (?:install|i)\b/;
/** The only `cancel-in-progress` value that cancels superseded runs: true on pull requests, false on `main`. */
const cancelOnPullRequestOnly = "${{ github.event_name == 'pull_request' }}";
/**
 * The group key that keeps runs apart per commit off pull requests. A group shared by every
 * push to `main` lets a newer run cancel the pending one, even with `cancel-in-progress: false`.
 */
const perRunGroupKey = "${{ github.event.pull_request.number || github.sha }}";

/** The `with:` inputs of the shared Bun install cache step every install step must follow. */
const bunCache = {
  path: "~/.bun/install/cache",
  key: "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}",
  restoreKeys: "${{ runner.os }}-bun-",
} as const;
const bunCacheDescription = `the actions/cache step for ${bunCache.path}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeProblem(file: string, job: string, rule: WorkflowRule, detail: string): string {
  return `${file}:${job} breaks ${rule}: ${detail}`;
}

/** A workflow triggered by a tag push publishes what it builds, so it must not restore a cache. */
function isReleaseWorkflow(workflow: Record<string, unknown>): boolean {
  const on = workflow["on"];
  if (!isRecord(on) || !isRecord(on["push"])) return false;
  return on["push"]["tags"] !== undefined;
}

function listTriggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on))
    return on.filter((trigger): trigger is string => typeof trigger === "string");
  if (isRecord(on)) return Object.keys(on);
  return [];
}

/** Flags a `concurrency` block, of a workflow or a job, that can cancel a run on `main`. */
function findCancellationProblems(file: string, scope: string, concurrency: unknown): string[] {
  if (!isRecord(concurrency)) return [];
  const cancel = concurrency["cancel-in-progress"];
  if (cancel === undefined || cancel === false || cancel === cancelOnPullRequestOnly) return [];
  const value = typeof cancel === "string" ? cancel : JSON.stringify(cancel);
  return [
    describeProblem(
      file,
      scope,
      "concurrency",
      `cancel-in-progress is ${value}, which cancels runs on main; use ${cancelOnPullRequestOnly}`,
    ),
  ];
}

/** A `pull_request` workflow groups its runs and cancels the superseded ones on pull requests only. */
function findConcurrencyProblems(file: string, workflow: Record<string, unknown>): string[] {
  const concurrency = workflow["concurrency"];
  const cancellationProblems = findCancellationProblems(file, workflowScope, concurrency);
  if (cancellationProblems.length > 0 || !listTriggers(workflow["on"]).includes("pull_request"))
    return cancellationProblems;
  const group = isRecord(concurrency) ? concurrency["group"] : undefined;
  if (typeof group !== "string" || group === "") {
    return [
      describeProblem(
        file,
        workflowScope,
        "concurrency",
        "a pull_request workflow must set top-level concurrency with a group",
      ),
    ];
  }
  if (!group.includes(perRunGroupKey)) {
    return [
      describeProblem(
        file,
        workflowScope,
        "concurrency",
        `group ${group} is shared by every run on main, so a newer run cancels the pending one; end it with ${perRunGroupKey}`,
      ),
    ];
  }
  if (isRecord(concurrency) && concurrency["cancel-in-progress"] === cancelOnPullRequestOnly)
    return [];
  return [
    describeProblem(
      file,
      workflowScope,
      "concurrency",
      `a pull_request workflow must cancel superseded runs with cancel-in-progress: ${cancelOnPullRequestOnly}`,
    ),
  ];
}

function findWorkflowLevelProblems(file: string, workflow: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const permissions = workflow["permissions"];
  if (permissions === undefined) {
    problems.push(
      describeProblem(file, workflowScope, "permissions", "top-level permissions is missing"),
    );
  } else if (!isRecord(permissions)) {
    problems.push(
      describeProblem(
        file,
        workflowScope,
        "permissions",
        "top-level permissions must be a map of read or none scopes",
      ),
    );
  } else {
    for (const [scope, level] of Object.entries(permissions)) {
      if (typeof level === "string" && readOnlyLevels.has(level)) continue;
      problems.push(
        describeProblem(
          file,
          workflowScope,
          "permissions",
          `top-level permissions grants ${scope}: ${String(level)}; grant writes per job`,
        ),
      );
    }
  }
  if (listTriggers(workflow["on"]).includes("pull_request_target")) {
    problems.push(
      describeProblem(
        file,
        workflowScope,
        "no-pull-request-target",
        "pull_request_target is a trigger",
      ),
    );
  }
  problems.push(...findConcurrencyProblems(file, workflow));
  return problems;
}

function stepLabel(step: Record<string, unknown>, index: number): string {
  const name = step["name"];
  return typeof name === "string" ? `"${name}"` : `#${index + 1}`;
}

function findStepProblems(
  file: string,
  job: string,
  step: Record<string, unknown>,
  index: number,
): string[] {
  const problems: string[] = [];
  const label = stepLabel(step, index);
  const uses = step["uses"];
  const inputs = isRecord(step["with"]) ? step["with"] : {};
  if (typeof uses === "string" && uses.startsWith("actions/checkout@")) {
    const persistCredentials = inputs["persist-credentials"];
    if (persistCredentials !== false && persistCredentials !== "false") {
      problems.push(
        describeProblem(
          file,
          job,
          "persist-credentials",
          `checkout step ${label} must set persist-credentials: false`,
        ),
      );
    }
  }
  if (typeof uses === "string" && uses.startsWith("actions/setup-node@")) {
    if (inputs["node-version-file"] !== ".node-version" || inputs["node-version"] !== undefined) {
      problems.push(
        describeProblem(
          file,
          job,
          "node-version-file",
          `setup-node step ${label} must use node-version-file: .node-version and no node-version`,
        ),
      );
    }
  }
  const run = step["run"];
  if (typeof run === "string" && run.includes("${{")) {
    problems.push(
      describeProblem(
        file,
        job,
        "no-expression-in-run",
        `step ${label} has \${{ }} inside run:; pass it through env:`,
      ),
    );
  }
  return problems;
}

/** Release workflows build from a clean install: no cache step and no setup action cache. */
function findReleaseCacheProblems(
  file: string,
  job: string,
  step: Record<string, unknown>,
  index: number,
): string[] {
  const uses = step["uses"];
  if (typeof uses !== "string") return [];
  const label = stepLabel(step, index);
  const inputs = isRecord(step["with"]) ? step["with"] : {};
  const detail = uses.startsWith("actions/cache")
    ? `cache step ${label} restores a cache in a release workflow`
    : uses.startsWith("oven-sh/setup-bun@") && inputs["no-cache"] !== true
      ? `setup-bun step ${label} must set no-cache: true`
      : uses.startsWith("actions/setup-node@") && inputs["package-manager-cache"] !== false
        ? `setup-node step ${label} must set package-manager-cache: false`
        : undefined;
  return detail === undefined ? [] : [describeProblem(file, job, "no-cache-on-release", detail)];
}

function findJobProblems(
  file: string,
  job: string,
  definition: Record<string, unknown>,
  isRelease: boolean,
): string[] {
  const problems: string[] = [];
  const callsReusableWorkflow = definition["uses"] !== undefined;
  if (!callsReusableWorkflow && definition["timeout-minutes"] === undefined) {
    problems.push(describeProblem(file, job, "timeout-minutes", "job sets no timeout-minutes"));
  }
  problems.push(...findCancellationProblems(file, job, definition["concurrency"]));
  const steps = Array.isArray(definition["steps"]) ? definition["steps"] : [];
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    problems.push(...findStepProblems(file, job, step, index));
    if (isRelease) problems.push(...findReleaseCacheProblems(file, job, step, index));
  });
  if (!isRelease) problems.push(...findBunCacheProblems(file, job, steps));
  return problems;
}

function isBunCacheStep(step: unknown): boolean {
  if (!isRecord(step)) return false;
  const uses = step["uses"];
  if (typeof uses !== "string" || !uses.startsWith("actions/cache@")) return false;
  const inputs = isRecord(step["with"]) ? step["with"] : {};
  return (
    inputs["path"] === bunCache.path &&
    inputs["key"] === bunCache.key &&
    inputs["restore-keys"] === bunCache.restoreKeys
  );
}

/** Every `bun install` or `bun i` step must come right after the shared Bun cache step. */
function findBunCacheProblems(file: string, job: string, steps: readonly unknown[]): string[] {
  const problems: string[] = [];
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const run = step["run"];
    if (typeof run !== "string" || !installCommand.test(run)) return;
    if (isBunCacheStep(steps[index - 1])) return;
    problems.push(
      describeProblem(
        file,
        job,
        "bun-cache",
        `install step ${stepLabel(step, index)} is not preceded by ${bunCacheDescription}`,
      ),
    );
  });
  return problems;
}

/** Scans the raw text because the version comment after a `uses:` is lost when the YAML is parsed. */
function findPinningProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  let insideJobs = false;
  let job = workflowScope;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (topLevelLine.test(line)) {
      insideJobs = line === "jobs:";
      job = workflowScope;
      continue;
    }
    const jobMatch = insideJobs ? jobKeyLine.exec(line) : null;
    if (jobMatch !== null) job = jobMatch[1] ?? workflowScope;
    const usesMatch = usesLine.exec(line);
    if (usesMatch === null) continue;
    const [, reference = "", versionComment] = usesMatch;
    if (reference.startsWith("./")) continue;
    if (!pinnedReference.test(reference)) {
      problems.push(
        describeProblem(
          file,
          job,
          "pinned-actions",
          `${reference} is not pinned to a 40-character SHA`,
        ),
      );
    } else if (versionComment === undefined || !exactVersionComment.test(versionComment)) {
      problems.push(
        describeProblem(
          file,
          job,
          "pinned-actions",
          `${reference} lacks a # vX.Y.Z version comment`,
        ),
      );
    }
  }
  return problems;
}

/** Returns one `<file>:<job> breaks <rule>: <detail>` line per S8 rule a workflow breaks. */
function findWorkflowProblems(file: string, text: string): string[] {
  const workflow: unknown = Bun.YAML.parse(text);
  if (!isRecord(workflow)) throw new Error(`${file} is not a YAML mapping`);
  const jobs = isRecord(workflow["jobs"]) ? workflow["jobs"] : {};
  const isRelease = isReleaseWorkflow(workflow);
  const jobProblems = Object.entries(jobs).flatMap(([job, definition]) =>
    isRecord(definition) ? findJobProblems(file, job, definition, isRelease) : [],
  );
  return [
    ...findWorkflowLevelProblems(file, workflow),
    ...jobProblems,
    ...findPinningProblems(file, text),
  ];
}

const sha = "a".repeat(40);

const fixtureConcurrency = `concurrency:
  group: fixture-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
`;

const fixtureCacheStep = `      - uses: actions/cache@${sha} # v6.1.0
        with:
          path: ${bunCache.path}
          key: ${bunCache.key}
          restore-keys: ${bunCache.restoreKeys}
`;

const validWorkflow = `name: Fixture

on:
  pull_request:

permissions:
  contents: read

${fixtureConcurrency}
jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@${sha} # v7.0.1
        with:
          persist-credentials: false

      - uses: actions/setup-node@${sha} # v7.1.0
        with:
          node-version-file: .node-version

${fixtureCacheStep}
      - name: Install
        run: bun install --frozen-lockfile

      - name: Print ref
        env:
          REF: \${{ github.ref }}
        run: echo "$REF"
`;

function breakFixture(search: string, replacement: string): string {
  expect(validWorkflow).toContain(search);
  return validWorkflow.replace(search, replacement);
}

const brokenFixtures: readonly {
  rule: WorkflowRule;
  search: string;
  replacement: string;
  expected: string;
}[] = [
  {
    rule: "timeout-minutes",
    search: "    timeout-minutes: 10\n",
    replacement: "",
    expected: "fixture.yml:build breaks timeout-minutes: job sets no timeout-minutes",
  },
  {
    rule: "persist-credentials",
    search: "          persist-credentials: false\n",
    replacement: "          persist-credentials: true\n",
    expected:
      "fixture.yml:build breaks persist-credentials: checkout step #1 must set persist-credentials: false",
  },
  {
    rule: "permissions",
    search: "\npermissions:\n  contents: read\n",
    replacement: "",
    expected: "fixture.yml:(workflow) breaks permissions: top-level permissions is missing",
  },
  {
    rule: "permissions",
    search: "  contents: read\n\nconcurrency:",
    replacement: "  contents: write\n\nconcurrency:",
    expected:
      "fixture.yml:(workflow) breaks permissions: top-level permissions grants contents: write; grant writes per job",
  },
  {
    rule: "permissions",
    search: "permissions:\n  contents: read\n\nconcurrency:",
    replacement: "permissions: write-all\n\nconcurrency:",
    expected:
      "fixture.yml:(workflow) breaks permissions: top-level permissions must be a map of read or none scopes",
  },
  {
    rule: "no-pull-request-target",
    search: "on:\n  pull_request:\n",
    replacement: "on:\n  pull_request_target:\n",
    expected:
      "fixture.yml:(workflow) breaks no-pull-request-target: pull_request_target is a trigger",
  },
  {
    rule: "concurrency",
    search: `${fixtureConcurrency}\n`,
    replacement: "",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must set top-level concurrency with a group",
  },
  {
    rule: "concurrency",
    search:
      "  group: fixture-${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}\n",
    replacement: "",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must set top-level concurrency with a group",
  },
  {
    rule: "concurrency",
    search: "${{ github.event.pull_request.number || github.sha }}",
    replacement: "${{ github.ref }}",
    expected:
      "fixture.yml:(workflow) breaks concurrency: group fixture-${{ github.workflow }}-${{ github.ref }} is shared by every run on main, so a newer run cancels the pending one; end it with ${{ github.event.pull_request.number || github.sha }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: true",
    expected:
      "fixture.yml:(workflow) breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
    expected:
      "fixture.yml:(workflow) breaks concurrency: cancel-in-progress is ${{ github.ref != 'refs/heads/main' }}, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: false",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must cancel superseded runs with cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "    timeout-minutes: 10\n",
    replacement:
      "    timeout-minutes: 10\n    concurrency:\n      group: build\n      cancel-in-progress: true\n",
    expected:
      "fixture.yml:build breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "no-expression-in-run",
    search: 'run: echo "$REF"',
    replacement: 'run: echo "${{ github.ref }}"',
    expected:
      'fixture.yml:build breaks no-expression-in-run: step "Print ref" has ${{ }} inside run:; pass it through env:',
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: "actions/checkout@v7",
    expected:
      "fixture.yml:build breaks pinned-actions: actions/checkout@v7 is not pinned to a 40-character SHA",
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: `actions/checkout@${sha} # v7`,
    expected: `fixture.yml:build breaks pinned-actions: actions/checkout@${sha} lacks a # vX.Y.Z version comment`,
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: `actions/checkout@${sha}`,
    expected: `fixture.yml:build breaks pinned-actions: actions/checkout@${sha} lacks a # vX.Y.Z version comment`,
  },
  {
    rule: "node-version-file",
    search: "node-version-file: .node-version",
    replacement: "node-version: 24",
    expected:
      "fixture.yml:build breaks node-version-file: setup-node step #2 must use node-version-file: .node-version and no node-version",
  },
  {
    rule: "bun-cache",
    search: `${fixtureCacheStep}\n`,
    replacement: "",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
  {
    rule: "bun-cache",
    search: "path: ~/.bun/install/cache",
    replacement: "path: node_modules",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
  {
    rule: "bun-cache",
    search: `          restore-keys: ${bunCache.restoreKeys}\n`,
    replacement: "",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
];

describe("S8: workflow hardening invariants", () => {
  test("every workflow in .github/workflows follows every rule", () => {
    const files = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((name) =>
      findWorkflowProblems(name, readFileSync(join(workflowsDirectory, name), "utf8")),
    );
    expect(problems).toEqual([]);
  });

  test("the valid fixture passes", () => {
    expect(findWorkflowProblems("fixture.yml", validWorkflow)).toEqual([]);
  });

  test.each(brokenFixtures)(
    "a fixture breaking $rule fails naming the file, job and rule",
    ({ search, replacement, expected }) => {
      expect(findWorkflowProblems("fixture.yml", breakFixture(search, replacement))).toEqual([
        expected,
      ]);
    },
  );

  test("pull_request_target is caught in list form", () => {
    const text = breakFixture("on:\n  pull_request:\n", "on: [push, pull_request_target]\n");
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      "fixture.yml:(workflow) breaks no-pull-request-target: pull_request_target is a trigger",
    ]);
  });

  test("an empty top-level permissions map passes", () => {
    const text = breakFixture(
      "permissions:\n  contents: read\n\nconcurrency:",
      "permissions: {}\n\nconcurrency:",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("a job calling a reusable workflow needs no timeout-minutes", () => {
    const text = `${validWorkflow}  reuse:\n    uses: ./.github/workflows/other.yml\n`;
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("an install step with extra flags and a cache right before it passes", () => {
    const text = breakFixture(
      "run: bun install --frozen-lockfile\n",
      "run: bun install --frozen-lockfile --ignore-scripts\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("a step between the cache and the install step fails", () => {
    const text = breakFixture(
      "      - name: Install\n",
      "      - name: Between\n        run: true\n\n      - name: Install\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
    ]);
  });

  test.each(["bun i --frozen-lockfile", "bun install"])(
    'the install form "%s" without a cache step is caught',
    (install) => {
      const text = `${validWorkflow}  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: ${install}\n`;
      expect(findWorkflowProblems("fixture.yml", text)).toEqual([
        `fixture.yml:other breaks bun-cache: install step #1 is not preceded by ${bunCacheDescription}`,
      ]);
    },
  );

  test("an install step in a second job without a cache names that job", () => {
    const text = `${validWorkflow}  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: bun install --frozen-lockfile\n`;
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      `fixture.yml:other breaks bun-cache: install step #1 is not preceded by ${bunCacheDescription}`,
    ]);
  });

  describe("a workflow triggered by a tag push", () => {
    const releaseWorkflow = `name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: oven-sh/setup-bun@${sha} # v2.2.0
        with:
          no-cache: true

      - uses: actions/setup-node@${sha} # v7.1.0
        with:
          node-version-file: .node-version
          package-manager-cache: false

      - name: Install
        run: bun install --frozen-lockfile
`;

    function breakRelease(search: string, replacement: string): string {
      expect(releaseWorkflow).toContain(search);
      return releaseWorkflow.replace(search, replacement);
    }

    test("fails when it cancels in-progress runs", () => {
      const text = breakRelease(
        "\njobs:",
        "\nconcurrency:\n  group: release\n  cancel-in-progress: true\n\njobs:",
      );
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:(workflow) breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
      ]);
    });

    test("may queue runs with cancel-in-progress: false", () => {
      const text = breakRelease(
        "\njobs:",
        "\nconcurrency:\n  group: release\n  cancel-in-progress: false\n\njobs:",
      );
      expect(findWorkflowProblems("release.yml", text)).toEqual([]);
    });

    test("installs without a cache step and with setup caches off", () => {
      expect(findWorkflowProblems("release.yml", releaseWorkflow)).toEqual([]);
    });

    test("fails when it restores the Bun cache before installing", () => {
      const text = breakRelease(
        "      - name: Install\n",
        `${fixtureCacheStep}\n      - name: Install\n`,
      );
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: cache step #3 restores a cache in a release workflow",
      ]);
    });

    test("fails when setup-bun keeps its cache", () => {
      const text = breakRelease("          no-cache: true\n", "          bun-version: latest\n");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: setup-bun step #1 must set no-cache: true",
      ]);
    });

    test("fails when setup-node keeps its package manager cache", () => {
      const text = breakRelease("          package-manager-cache: false\n", "");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: setup-node step #2 must set package-manager-cache: false",
      ]);
    });
  });

  test("CRLF line endings do not hide an unpinned reference", () => {
    const text = breakFixture(`actions/checkout@${sha} # v7.0.1`, "actions/checkout@v7").replaceAll(
      "\n",
      "\r\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      "fixture.yml:build breaks pinned-actions: actions/checkout@v7 is not pinned to a 40-character SHA",
    ]);
  });
});
