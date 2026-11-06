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
  | "no-expression-in-run"
  | "pinned-actions"
  | "node-version-file"
  | "bun-cache";

/** The job slot used for problems that belong to the whole workflow rather than one job. */
const workflowScope = "(workflow)";
const pinnedReference = /^[^@\s]+@[0-9a-f]{40}$/;
const exactVersionComment = /^v\d+\.\d+\.\d+$/;
const usesLine = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S.*?))?\s*$/;
const jobKeyLine = /^ {2}([A-Za-z0-9_-]+):/;
const topLevelLine = /^\S/;
const readOnlyLevels = new Set(["read", "none"]);
const frozenInstall = /\bbun install\b[^\n]*--frozen-lockfile/;

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

function listTriggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on))
    return on.filter((trigger): trigger is string => typeof trigger === "string");
  if (isRecord(on)) return Object.keys(on);
  return [];
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

function findJobProblems(file: string, job: string, definition: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const callsReusableWorkflow = definition["uses"] !== undefined;
  if (!callsReusableWorkflow && definition["timeout-minutes"] === undefined) {
    problems.push(describeProblem(file, job, "timeout-minutes", "job sets no timeout-minutes"));
  }
  const steps = Array.isArray(definition["steps"]) ? definition["steps"] : [];
  steps.forEach((step: unknown, index) => {
    if (isRecord(step)) problems.push(...findStepProblems(file, job, step, index));
  });
  problems.push(...findBunCacheProblems(file, job, steps));
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

/** Every `bun install --frozen-lockfile` step must come right after the shared Bun cache step. */
function findBunCacheProblems(file: string, job: string, steps: readonly unknown[]): string[] {
  const problems: string[] = [];
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const run = step["run"];
    if (typeof run !== "string" || !frozenInstall.test(run)) return;
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
  const jobProblems = Object.entries(jobs).flatMap(([job, definition]) =>
    isRecord(definition) ? findJobProblems(file, job, definition) : [],
  );
  return [
    ...findWorkflowLevelProblems(file, workflow),
    ...jobProblems,
    ...findPinningProblems(file, text),
  ];
}

const sha = "a".repeat(40);

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
    search: "  contents: read\n\njobs:",
    replacement: "  contents: write\n\njobs:",
    expected:
      "fixture.yml:(workflow) breaks permissions: top-level permissions grants contents: write; grant writes per job",
  },
  {
    rule: "permissions",
    search: "permissions:\n  contents: read\n\njobs:",
    replacement: "permissions: write-all\n\njobs:",
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
      "permissions:\n  contents: read\n\njobs:",
      "permissions: {}\n\njobs:",
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

  test("an install step in a second job without a cache names that job", () => {
    const text = `${validWorkflow}  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: bun install --frozen-lockfile\n`;
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      `fixture.yml:other breaks bun-cache: install step #1 is not preceded by ${bunCacheDescription}`,
    ]);
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
