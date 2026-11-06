import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "labels.yml");

/**
 * Applying labels while the repository is private is a go-public step, so the sync must stay a
 * dry run on every event until the repository is public.
 */
describe("labels sync workflow", () => {
  test("runs as a dry run while the repository is private", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const dryRunLine = workflow.split("\n").find((line) => line.trim().startsWith("dry-run:"));

    expect(dryRunLine).toBeDefined();
    expect(dryRunLine).toContain("github.event.repository.private");
    expect(dryRunLine).toContain("github.event_name == 'pull_request'");
  });
});
