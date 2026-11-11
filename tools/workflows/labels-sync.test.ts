import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "labels.yml");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `with:` inputs of the labeler step in `labels.yml`. */
function readLabelerInputs(): Record<string, unknown> {
  const workflow: unknown = Bun.YAML.parse(readFileSync(workflowPath, "utf8"));
  const jobs = isRecord(workflow) && isRecord(workflow["jobs"]) ? workflow["jobs"] : {};
  const steps = Object.values(jobs).flatMap((job): unknown[] =>
    isRecord(job) && Array.isArray(job["steps"]) ? job["steps"] : [],
  );
  const labeler = steps.find(
    (step) =>
      isRecord(step) &&
      typeof step["uses"] === "string" &&
      step["uses"].startsWith("crazy-max/ghaction-github-labeler@"),
  );
  if (!isRecord(labeler) || !isRecord(labeler["with"])) {
    throw new Error("labels.yml has no labeler step with inputs");
  }
  return labeler["with"];
}

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

  /**
   * `develop` runs ahead of `main`, so its label file can lack a label that `main` still declares.
   * A push to `develop` creates and updates labels and leaves deletions to the promotion.
   */
  test("S3: deletes a label only on a push to main, never on a push to develop", () => {
    expect(readLabelerInputs()["skip-delete"]).toBe("${{ github.ref != 'refs/heads/main' }}");
  });
});
