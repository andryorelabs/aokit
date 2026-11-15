import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createGhRunner, runCheck, type GhResult, type GhRunner } from "./check.ts";
import { isRecord } from "./compare.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const repository = "andryorelabs/aokit";
const rulesetIds: Readonly<Record<string, number>> = {
  develop: 26780599,
  main: 26780591,
  tags: 26780594,
};

function readJson(...segments: string[]): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(join(repoRoot, ...segments), "utf8"));
  if (!isRecord(value)) throw new Error(`${segments.join("/")} is not a JSON object`);
  return value;
}

function ok(body: unknown): GhResult {
  return { exitCode: 0, stdout: body === undefined ? "" : JSON.stringify(body), stderr: "" };
}

const notFound: GhResult = {
  exitCode: 1,
  stdout: '{"message":"Not Found","status":"404"}',
  stderr: "gh: Not Found (HTTP 404)",
};

/** The `gh api` responses of a repository whose live settings equal the files, by endpoint. */
function liveResponsesFromFiles(): Record<string, GhResult> {
  const settings = readJson(".github", "repo-settings.json");
  const expectedRepository = isRecord(settings.repository) ? settings.repository : {};
  const topics = Array.isArray(expectedRepository.topics) ? expectedRepository.topics : [];
  const actions = isRecord(settings.actions) ? settings.actions : {};
  const codeScanning = isRecord(settings.code_scanning) ? settings.code_scanning : {};
  const responses: Record<string, GhResult> = {
    [`repos/${repository}`]: ok({
      ...expectedRepository,
      id: 1,
      full_name: repository,
      has_issues: true,
      topics: topics.toReversed(),
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
        dependabot_security_updates: { status: "enabled" },
        secret_scanning_validity_checks: { status: "disabled" },
      },
    }),
    [`repos/${repository}/vulnerability-alerts`]: ok(undefined),
    [`repos/${repository}/private-vulnerability-reporting`]: ok({ enabled: true }),
    [`repos/${repository}/actions/permissions/workflow`]: ok({
      default_workflow_permissions: actions.default_workflow_permissions,
      can_approve_pull_request_reviews: actions.can_approve_pull_request_reviews,
    }),
    [`repos/${repository}/actions/permissions/fork-pr-contributor-approval`]: ok({
      approval_policy: actions.fork_pr_contributor_approval,
    }),
    [`repos/${repository}/code-scanning/default-setup`]: ok({
      state: codeScanning.default_setup,
      languages: ["actions", "javascript-typescript"],
      query_suite: "default",
      updated_at: null,
      schedule: null,
    }),
    [`repos/${repository}/rulesets?per_page=100`]: ok(
      Object.entries(rulesetIds).map(([name, id]) => ({ id, name, enforcement: "active" })),
    ),
  };
  for (const [name, id] of Object.entries(rulesetIds)) {
    const ruleset = readJson(".github", "rulesets", `${name}.json`);
    const rules = Array.isArray(ruleset.rules) ? ruleset.rules : [];
    responses[`repos/${repository}/rulesets/${id}`] = ok({
      ...ruleset,
      id,
      source: repository,
      rules: rules.toReversed(),
    });
  }
  return responses;
}

interface Harness {
  runGh: GhRunner;
  calls: (readonly string[])[];
  lines: string[];
}

function createHarness(responses: Record<string, GhResult>): Harness {
  const calls: (readonly string[])[] = [];
  const lines: string[] = [];
  return {
    calls,
    lines,
    runGh: (args) => {
      calls.push(args);
      return responses[args.at(-1) ?? ""] ?? notFound;
    },
  };
}

function check(responses: Record<string, GhResult>): Harness & { exitCode: number } {
  const harness = createHarness(responses);
  const exitCode = runCheck({
    repoRoot,
    repository,
    runGh: harness.runGh,
    print: (line) => harness.lines.push(line),
  });
  return { ...harness, exitCode };
}

function withBody(
  responses: Record<string, GhResult>,
  endpoint: string,
  change: (body: Record<string, unknown>) => void,
): Record<string, GhResult> {
  const body: unknown = JSON.parse(responses[endpoint]?.stdout ?? "null");
  if (!isRecord(body)) throw new Error(`no JSON object response for ${endpoint}`);
  change(body);
  return { ...responses, [endpoint]: ok(body) };
}

describe("S8: repo-settings:check", () => {
  test("live settings equal to the files exit 0, whatever order topics and rules come in", () => {
    const result = check(liveResponsesFromFiles());
    expect(result.lines).toEqual([
      "Live settings of andryorelabs/aokit match .github/repo-settings.json and .github/rulesets (develop.json, main.json, tags.json).",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("the check only sends GET requests through gh api", () => {
    const result = check(liveResponsesFromFiles());
    expect(result.calls.map((args) => args.at(-1))).toEqual([
      "repos/andryorelabs/aokit",
      "repos/andryorelabs/aokit/vulnerability-alerts",
      "repos/andryorelabs/aokit/private-vulnerability-reporting",
      "repos/andryorelabs/aokit/actions/permissions/workflow",
      "repos/andryorelabs/aokit/actions/permissions/fork-pr-contributor-approval",
      "repos/andryorelabs/aokit/code-scanning/default-setup",
      "repos/andryorelabs/aokit/rulesets?per_page=100",
      "repos/andryorelabs/aokit/rulesets/26780599",
      "repos/andryorelabs/aokit/rulesets/26780591",
      "repos/andryorelabs/aokit/rulesets/26780594",
    ]);
    for (const args of result.calls) {
      expect(args.slice(0, -1)).toEqual(["api", "--method", "GET"]);
    }
  });

  test("one differing repository setting exits 1 and prints setting, expected and live", () => {
    const responses = withBody(liveResponsesFromFiles(), `repos/${repository}`, (body) => {
      body.allow_auto_merge = false;
    });
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json repository.allow_auto_merge",
      "  expected: true",
      "  live:     false",
      "1 live setting of andryorelabs/aokit differs from the files.",
    ]);
  });

  test("a security feature that is off live is drift", () => {
    const responses = withBody(liveResponsesFromFiles(), `repos/${repository}`, (body) => {
      body.security_and_analysis = { secret_scanning: { status: "disabled" } };
    });
    responses[`repos/${repository}/vulnerability-alerts`] = notFound;
    responses[`repos/${repository}/private-vulnerability-reporting`] = ok({ enabled: false });
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json security.secret_scanning",
      "  expected: true",
      "  live:     false",
      "Drift: repo-settings.json security.secret_scanning_push_protection",
      "  expected: true",
      "  live:     undefined",
      "Drift: repo-settings.json security.dependabot_alerts",
      "  expected: true",
      "  live:     false",
      "Drift: repo-settings.json security.dependabot_security_updates",
      "  expected: true",
      "  live:     undefined",
      "Drift: repo-settings.json security.private_vulnerability_reporting",
      "  expected: true",
      "  live:     false",
      "5 live settings of andryorelabs/aokit differ from the files.",
    ]);
  });

  test("a default branch that differs live is named", () => {
    const responses = withBody(liveResponsesFromFiles(), `repos/${repository}`, (body) => {
      body.default_branch = "develop";
    });
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json repository.default_branch",
      '  expected: "main"',
      '  live:     "develop"',
      "1 live setting of andryorelabs/aokit differs from the files.",
    ]);
  });

  test("a GITHUB_TOKEN that defaults to write live is named", () => {
    const responses = withBody(
      liveResponsesFromFiles(),
      `repos/${repository}/actions/permissions/workflow`,
      (body) => {
        body.default_workflow_permissions = "write";
        body.can_approve_pull_request_reviews = true;
      },
    );
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json actions.default_workflow_permissions",
      '  expected: "read"',
      '  live:     "write"',
      "Drift: repo-settings.json actions.can_approve_pull_request_reviews",
      "  expected: false",
      "  live:     true",
      "2 live settings of andryorelabs/aokit differ from the files.",
    ]);
  });

  test("a fork pull request approval policy that differs live is named", () => {
    const responses = withBody(
      liveResponsesFromFiles(),
      `repos/${repository}/actions/permissions/fork-pr-contributor-approval`,
      (body) => {
        body.approval_policy = "first_time_contributors_new_to_github";
      },
    );
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json actions.fork_pr_contributor_approval",
      '  expected: "first_time_contributors"',
      '  live:     "first_time_contributors_new_to_github"',
      "1 live setting of andryorelabs/aokit differs from the files.",
    ]);
  });

  test("a CodeQL default setup that is configured live is named", () => {
    const responses = withBody(
      liveResponsesFromFiles(),
      `repos/${repository}/code-scanning/default-setup`,
      (body) => {
        body.state = "configured";
      },
    );
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: repo-settings.json code_scanning.default_setup",
      '  expected: "not-configured"',
      '  live:     "configured"',
      "1 live setting of andryorelabs/aokit differs from the files.",
    ]);
  });

  test("a failed request for the Actions or CodeQL settings fails the check", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}/code-scanning/default-setup`] = {
      exitCode: 1,
      stdout: "",
      stderr: "gh: Resource not accessible by integration (HTTP 403)",
    };
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "repo-settings:check could not read the live settings: gh api repos/andryorelabs/aokit/code-scanning/default-setup failed with exit code 1: gh: Resource not accessible by integration (HTTP 403). Run `gh auth status` to check that gh is installed and authenticated.",
    ]);
  });

  test("a ruleset parameter that differs live is named by ruleset file, rule type and parameter", () => {
    const endpoint = `repos/${repository}/rulesets/${rulesetIds.main}`;
    const responses = withBody(liveResponsesFromFiles(), endpoint, (body) => {
      const rules = Array.isArray(body.rules) ? body.rules : [];
      const pullRequest: unknown = rules.find(
        (rule: unknown) => isRecord(rule) && rule.type === "pull_request",
      );
      if (!isRecord(pullRequest) || !isRecord(pullRequest.parameters)) {
        throw new Error("main.json has no pull_request rule");
      }
      pullRequest.parameters.required_review_thread_resolution = false;
    });
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines.slice(0, 3)).toEqual([
      "Drift: rulesets/main.json rules.pull_request.required_review_thread_resolution",
      "  expected: true",
      "  live:     false",
    ]);
  });

  test("a rule missing live and a rule only live are both drift", () => {
    const endpoint = `repos/${repository}/rulesets/${rulesetIds.main}`;
    const responses = withBody(liveResponsesFromFiles(), endpoint, (body) => {
      const rules = Array.isArray(body.rules) ? body.rules : [];
      body.rules = rules
        .filter((rule: unknown) => isRecord(rule) && rule.type !== "required_signatures")
        .concat([{ type: "creation" }]);
    });
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: rulesets/main.json rules.required_signatures",
      "  expected: {}",
      "  live:     undefined",
      "Drift: rulesets/main.json rules.creation",
      "  expected: undefined",
      "  live:     {}",
      "2 live settings of andryorelabs/aokit differ from the files.",
    ]);
  });

  test("a ruleset file with no live ruleset of that name is drift", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}/rulesets?per_page=100`] = ok([
      { id: rulesetIds.main, name: "main" },
    ]);
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "Drift: rulesets/develop.json",
      '  expected: "a live ruleset named develop"',
      "  live:     undefined",
      "Drift: rulesets/tags.json",
      '  expected: "a live ruleset named tags"',
      "  live:     undefined",
      "2 live settings of andryorelabs/aokit differ from the files.",
    ]);
  });

  test("responses of an unexpected shape are drift, never a match", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}`] = ok([]);
    responses[`repos/${repository}/private-vulnerability-reporting`] = ok([]);
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines.filter((line) => line.startsWith("Drift: "))).toEqual([
      "Drift: repo-settings.json repository",
      "Drift: repo-settings.json security.secret_scanning",
      "Drift: repo-settings.json security.secret_scanning_push_protection",
      "Drift: repo-settings.json security.dependabot_security_updates",
      "Drift: repo-settings.json security.private_vulnerability_reporting",
    ]);
  });

  test("an unauthenticated gh fails with the gh message and never reports a match", () => {
    const unauthenticated: GhResult = {
      exitCode: 4,
      stdout: "",
      stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
    };
    const harness = createHarness({});
    const exitCode = runCheck({
      repoRoot,
      repository,
      runGh: () => unauthenticated,
      print: (line) => harness.lines.push(line),
    });
    expect(exitCode).toBe(1);
    expect(harness.lines).toEqual([
      "repo-settings:check could not read the live settings: gh api repos/andryorelabs/aokit failed with exit code 4: To get started with GitHub CLI, please run:  gh auth login. Run `gh auth status` to check that gh is installed and authenticated.",
    ]);
  });

  test("a failed request other than a 404 on Dependabot alerts fails the check", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}/vulnerability-alerts`] = {
      exitCode: 1,
      stdout: "",
      stderr: "gh: Bad credentials (HTTP 401)",
    };
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "repo-settings:check could not read the live settings: gh api repos/andryorelabs/aokit/vulnerability-alerts failed with exit code 1: gh: Bad credentials (HTTP 401). Run `gh auth status` to check that gh is installed and authenticated.",
    ]);
  });

  test("a response that is not JSON fails the check", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}/rulesets?per_page=100`] = {
      exitCode: 0,
      stdout: "<html>",
      stderr: "",
    };
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "repo-settings:check could not read the live settings: gh api repos/andryorelabs/aokit/rulesets?per_page=100 did not return JSON.",
    ]);
  });

  test("a missing gh binary fails with a clear message", () => {
    const lines: string[] = [];
    const exitCode = runCheck({
      repoRoot,
      repository,
      runGh: createGhRunner("gh-binary-that-is-not-installed"),
      print: (line) => lines.push(line),
    });
    expect(exitCode).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(
      "repo-settings:check could not read the live settings: could not run gh-binary-that-is-not-installed. Install the GitHub CLI (https://cli.github.com) and put it on PATH.",
    );
  });

  test("a gh that does not answer in time fails the check instead of hanging", () => {
    const lines: string[] = [];
    const exitCode = runCheck({
      repoRoot,
      repository,
      runGh: () => createGhRunner(process.execPath, 200)(["-e", "await Bun.sleep(60_000)"]),
      print: (line) => lines.push(line),
    });
    expect(exitCode).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("did not finish within 200 ms");
  });

  test("a full page of rulesets fails the check, because the list may be incomplete", () => {
    const responses = liveResponsesFromFiles();
    responses[`repos/${repository}/rulesets?per_page=100`] = ok(
      Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `ruleset-${index}` })),
    );
    const result = check(responses);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([
      "repo-settings:check could not read the live settings: andryorelabs/aokit has 100 or more rulesets, so the list may be incomplete.",
    ]);
  });

  test("the gh runner returns the exit code and output of the command it runs", () => {
    const result = createGhRunner(process.execPath)(["--version"]);
    expect(result).toEqual({ exitCode: 0, stdout: `${Bun.version}\n`, stderr: "" });
  });
});
