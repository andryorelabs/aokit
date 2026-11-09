import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBinaryTarget } from "../build-binary/targets.ts";

const distributionPath = join(
  import.meta.dir,
  "..",
  "..",
  ".github",
  "workflows",
  "distribution.yml",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not a mapping`);
  return value;
}

const workflow = asRecord(
  Bun.YAML.parse(readFileSync(distributionPath, "utf8")),
  "distribution.yml",
);
const jobs = asRecord(workflow["jobs"], "jobs");

function stepRuns(jobName: string): string[] {
  const steps = asRecord(jobs[jobName], `job ${jobName}`)["steps"];
  if (!Array.isArray(steps)) throw new Error(`job ${jobName} has no steps`);
  return steps.flatMap((step: unknown) => {
    const run = asRecord(step, `${jobName} step`)["run"];
    return typeof run === "string" ? [run] : [];
  });
}

describe("S3: PR distribution builds and tests the natively tested binaries", () => {
  test("linux-x64 keeps its job and arm64 covers linux-arm64 and darwin-arm64 on native runners", () => {
    expect(Object.keys(jobs)).toEqual(["linux-x64", "arm64"]);
    const arm64 = asRecord(jobs["arm64"], "job arm64");
    expect(arm64["runs-on"]).toBe("${{ matrix.runner }}");
    const matrix = asRecord(asRecord(arm64["strategy"], "strategy")["matrix"], "matrix");
    const include = matrix["include"];
    if (!Array.isArray(include)) throw new Error("arm64 matrix has no include list");
    const entries = include.map((entry: unknown) => asRecord(entry, "matrix entry"));
    expect(entries.map((entry) => [entry["target"], entry["runner"]])).toEqual([
      ["bun-linux-arm64", "ubuntu-24.04-arm"],
      ["bun-darwin-arm64", "macos-latest"],
    ]);
    for (const entry of entries) {
      expect(entry["artifact"]).toBe(parseBinaryTarget(String(entry["target"])).outputName);
    }
  });

  test.each(["linux-x64", "arm64"])(
    "%s builds the package and binary and runs the process, tarball and e2e tests",
    (jobName) => {
      const commands = stepRuns(jobName).join("\n");
      for (const command of [
        "bun run build:package",
        "bun run lint:package",
        "bun run build:binary -- --target",
        "bun test packages/aokit/test",
        "bun test packages/aokit/test/dist/package",
        "bun test packages/aokit/test/dist/e2e",
      ]) {
        expect(commands).toContain(command);
      }
    },
  );
});
