import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./compare.ts";

const repoRoot = join(import.meta.dir, "..", "..");

function readText(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

const settings: unknown = JSON.parse(readText(".github", "repo-settings.json"));
const repository = isRecord(settings) && isRecord(settings.repository) ? settings.repository : {};
const security = isRecord(settings) ? settings.security : undefined;
const githubAbout = readText("docs", "brand", "copy.md").split("## GitHub About")[1] ?? "";

describe("S8: .github/repo-settings.json", () => {
  test("the file has exactly the repository, security, actions and code scanning sections", () => {
    expect(Object.keys(isRecord(settings) ? settings : {})).toEqual([
      "repository",
      "security",
      "actions",
      "code_scanning",
    ]);
  });

  test("the old name .github/settings.json is gone", () => {
    expect(existsSync(join(repoRoot, ".github", "settings.json"))).toBe(false);
  });

  test("A1: main is the default branch", () => {
    expect(repository.default_branch).toBe("main");
  });

  test("V12: the GITHUB_TOKEN is read-only by default and fork pull requests need approval", () => {
    expect(isRecord(settings) ? settings.actions : undefined).toEqual({
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
      fork_pr_contributor_approval: "first_time_contributors",
    });
  });

  test("V29: CodeQL default setup is off, because the codeql workflow is the advanced setup", () => {
    expect(isRecord(settings) ? settings.code_scanning : undefined).toEqual({
      default_setup: "not-configured",
    });
    expect(existsSync(join(repoRoot, ".github", "workflows", "codeql.yml"))).toBe(true);
  });

  test("S2: merge commits are allowed, because a promotion of develop to main merges with one", () => {
    expect(repository.allow_merge_commit).toBe(true);
  });

  test("A1 to A3: squash and merge commits, no rebase, with branch cleanup, auto-merge, update branch and PR title and body", () => {
    expect(repository).toMatchObject({
      allow_squash_merge: true,
      allow_merge_commit: true,
      allow_rebase_merge: false,
      delete_branch_on_merge: true,
      allow_auto_merge: true,
      allow_update_branch: true,
      squash_merge_commit_title: "PR_TITLE",
      squash_merge_commit_message: "PR_BODY",
      merge_commit_title: "PR_TITLE",
      merge_commit_message: "PR_BODY",
    });
  });

  test("A6: every security feature is on", () => {
    expect(security).toEqual({
      secret_scanning: true,
      secret_scanning_push_protection: true,
      dependabot_alerts: true,
      dependabot_security_updates: true,
      private_vulnerability_reporting: true,
    });
  });

  test("A7: description, homepage and topics are the GitHub About copy in docs/brand/copy.md", () => {
    const [description, homepage] = [...githubAbout.matchAll(/```text\n(.+)\n```/g)].map(
      (match) => match[1],
    );
    const topicsLine = /^Topics: (.+)\.$/m.exec(githubAbout)?.[1] ?? "";
    const topics = [...topicsLine.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(topics.length).toBeGreaterThanOrEqual(5);
    expect(repository.description).toBe(description);
    expect(repository.homepage).toBe(homepage);
    expect(repository.topics).toEqual(topics);
  });

  test("A8: wiki, projects and discussions are off", () => {
    expect(repository).toMatchObject({
      has_wiki: false,
      has_projects: false,
      has_discussions: false,
    });
  });
});
