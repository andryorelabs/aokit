import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bumppConfig from "../../bumpp.config.ts";

const repositoryRoot = join(import.meta.dir, "..", "..");
const releaseWorkflowPath = join(repositoryRoot, ".github", "workflows", "release.yml");
const resolveStepName = "Resolve version, dist-tag and dry-run";
const publishStepName = "Publish aokit then create-aokit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not a mapping`);
  return value;
}

function readJson(path: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(join(repositoryRoot, path), "utf8")), path);
}

const workflow = asRecord(Bun.YAML.parse(readFileSync(releaseWorkflowPath, "utf8")), "release.yml");
const jobs = asRecord(workflow["jobs"], "jobs");

function job(name: string): Record<string, unknown> {
  return asRecord(jobs[name], `job ${name}`);
}

function steps(jobName: string): Record<string, unknown>[] {
  const list = job(jobName)["steps"];
  if (!Array.isArray(list)) throw new Error(`job ${jobName} has no steps`);
  return list.map((step, index) => asRecord(step, `${jobName} step ${index + 1}`));
}

function runScript(jobName: string, stepName: string): string {
  const step = steps(jobName).find((candidate) => candidate["name"] === stepName);
  const run = step?.["run"];
  if (typeof run !== "string") throw new Error(`${jobName} has no "${stepName}" run step`);
  return run;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-release-workflow-"));
  temporaryDirectories.push(directory);
  return directory;
}

interface ScriptResult {
  exitCode: number;
  output: string;
}

/** Runs a workflow `run:` script the way GitHub runs a bash step. */
function runBash(script: string, cwd: string, env: Record<string, string>): ScriptResult {
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

interface ReleaseInputs {
  aokitVersion: string;
  createAokitVersion?: string;
  createAokitDependency?: string;
  eventName: "push" | "workflow_dispatch";
  refType: "tag" | "branch";
  refName: string;
  inputDryRun?: string;
}

interface ResolvedRelease extends ScriptResult {
  outputs: Record<string, string>;
}

function resolveRelease(inputs: ReleaseInputs): ResolvedRelease {
  const directory = temporaryDirectory();
  mkdirSync(join(directory, "packages", "aokit"), { recursive: true });
  mkdirSync(join(directory, "packages", "create-aokit"), { recursive: true });
  writeFileSync(
    join(directory, "packages", "aokit", "package.json"),
    JSON.stringify({ name: "aokit", version: inputs.aokitVersion }),
  );
  writeFileSync(
    join(directory, "packages", "create-aokit", "package.json"),
    JSON.stringify({
      name: "create-aokit",
      version: inputs.createAokitVersion ?? inputs.aokitVersion,
      dependencies: { aokit: inputs.createAokitDependency ?? inputs.aokitVersion },
    }),
  );
  const outputFile = join(directory, "github-output");
  writeFileSync(outputFile, "");
  const result = runBash(runScript("verify", resolveStepName), directory, {
    GITHUB_OUTPUT: outputFile,
    EVENT_NAME: inputs.eventName,
    REF_TYPE: inputs.refType,
    REF_NAME: inputs.refName,
    INPUT_DRY_RUN: inputs.inputDryRun ?? "",
  });
  const outputs = Object.fromEntries(
    readFileSync(outputFile, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  return { ...result, outputs };
}

/** Runs the publish step with a fake `npm` on PATH and returns each recorded `npm` call. */
function publishCalls(dryRun: string, distTag = "next", version = "0.1.0-next.0"): string[] {
  const directory = temporaryDirectory();
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  const callLog = join(directory, "npm-calls");
  const fakeNpm = join(binDirectory, "npm");
  writeFileSync(fakeNpm, `#!/usr/bin/env bash\necho "npm $*" >> "${callLog}"\n`);
  chmodSync(fakeNpm, 0o755);
  writeFileSync(callLog, "");
  const result = runBash(runScript("publish", publishStepName), directory, {
    PATH: `${binDirectory}:${process.env["PATH"] ?? ""}`,
    VERSION: version,
    DIST_TAG: distTag,
    DRY_RUN: dryRun,
    RELEASE_DIR: "/release",
  });
  expect(result.exitCode).toBe(0);
  return readFileSync(callLog, "utf8").split("\n").filter(Boolean);
}

describe("S2: release workflow", () => {
  test("a v* tag push and a manual dispatch with a dry-run input default to true trigger it", () => {
    const on = asRecord(workflow["on"], "on");
    expect(asRecord(on["push"], "on.push")["tags"]).toEqual(["v*"]);
    const dispatch = asRecord(on["workflow_dispatch"], "on.workflow_dispatch");
    const dryRun = asRecord(asRecord(dispatch["inputs"], "inputs")["dry-run"], "dry-run input");
    expect(dryRun["type"]).toBe("boolean");
    expect(dryRun["default"]).toBe(true);
    expect(Object.keys(on).toSorted()).toEqual(["push", "workflow_dispatch"]);
  });

  test("verify runs first, the binaries placeholder follows and publish runs last", () => {
    expect(Object.keys(jobs)).toEqual(["verify", "binaries", "publish"]);
    expect(job("binaries")["needs"]).toBe("verify");
    expect(job("publish")["needs"]).toEqual(["verify", "binaries"]);
  });

  test("the workflow is read-only and only publish gets id-token: write", () => {
    expect(workflow["permissions"]).toEqual({ contents: "read" });
    expect(job("publish")["permissions"]).toEqual({ contents: "read", "id-token": "write" });
    for (const name of ["verify", "binaries"]) {
      expect(job(name)["permissions"]).toBeUndefined();
    }
  });

  test("verify checks, tests, builds, lints and packs both packages", () => {
    const commands = steps("verify")
      .map((step) => step["run"])
      .filter((run): run is string => typeof run === "string")
      .join("\n");
    for (const command of [
      "bun run check",
      "bun run test",
      "bun run build:package",
      "bun run lint:package",
      "(cd packages/aokit && bun pm pack",
      "(cd packages/create-aokit && bun pm pack",
      "bun test packages/aokit/test/dist/package",
      "bun run release:notes",
    ]) {
      expect(commands).toContain(command);
    }
  });

  test("npm publish appears only in the publish job", () => {
    for (const name of ["verify", "binaries"]) {
      const runs = steps(name).map((step) => step["run"]);
      expect(runs.some((run) => typeof run === "string" && run.includes("npm publish"))).toBe(
        false,
      );
    }
  });

  describe("resolving the version, dist-tag and dry-run", () => {
    test("a pushed pre-release tag publishes for real under next", () => {
      const result = resolveRelease({
        aokitVersion: "0.1.0-next.0",
        eventName: "push",
        refType: "tag",
        refName: "v0.1.0-next.0",
      });
      expect(result.exitCode).toBe(0);
      expect(result.outputs).toEqual({
        version: "0.1.0-next.0",
        "dist-tag": "next",
        "dry-run": "false",
      });
    });

    test.each([
      ["1.0.0", "latest"],
      ["1.2.3-rc.1", "next"],
      ["1.0.0+build-7", "latest"],
    ])("version %s publishes under %s", (version, distTag) => {
      const result = resolveRelease({
        aokitVersion: version,
        eventName: "push",
        refType: "tag",
        refName: `v${version}`,
      });
      expect(result.exitCode).toBe(0);
      expect(result.outputs["dist-tag"]).toBe(distTag);
    });

    test.each([
      ["a branch dispatch with dry-run true", "branch", "main", "true"],
      ["a branch dispatch with dry-run false", "branch", "main", "false"],
      ["a tag dispatch with dry-run true", "tag", "v0.1.0-next.0", "true"],
    ] as const)("%s is a dry run", (_label, refType, refName, inputDryRun) => {
      const result = resolveRelease({
        aokitVersion: "0.1.0-next.0",
        eventName: "workflow_dispatch",
        refType,
        refName,
        inputDryRun,
      });
      expect(result.exitCode).toBe(0);
      expect(result.outputs["dry-run"]).toBe("true");
    });

    test("a tag dispatch with dry-run false publishes for real", () => {
      const result = resolveRelease({
        aokitVersion: "0.1.0-next.0",
        eventName: "workflow_dispatch",
        refType: "tag",
        refName: "v0.1.0-next.0",
        inputDryRun: "false",
      });
      expect(result.outputs["dry-run"]).toBe("false");
    });

    test("a tag that does not match the package version fails", () => {
      const result = resolveRelease({
        aokitVersion: "0.1.0-next.0",
        eventName: "push",
        refType: "tag",
        refName: "v0.1.0",
      });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(
        "tag v0.1.0 does not match the package version v0.1.0-next.0",
      );
      expect(result.outputs).toEqual({});
    });

    test.each([
      ["create-aokit at another version", { createAokitVersion: "0.1.0" }],
      ["create-aokit depending on another aokit", { createAokitDependency: "0.1.0" }],
    ])("%s fails", (_label, mismatch) => {
      const result = resolveRelease({
        aokitVersion: "0.1.0-next.0",
        eventName: "push",
        refType: "tag",
        refName: "v0.1.0-next.0",
        ...mismatch,
      });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("must match aokit 0.1.0-next.0");
    });
  });

  describe("publishing", () => {
    test.each(["true", "", "yes", "False"])(
      'DRY_RUN "%s" reaches only npm publish --dry-run',
      (dryRun) => {
        const calls = publishCalls(dryRun);
        expect(calls).toHaveLength(2);
        for (const call of calls) expect(call).toEndWith("--dry-run");
      },
    );

    test("a real publish sends aokit then create-aokit with provenance and the dist-tag", () => {
      expect(publishCalls("false", "next")).toEqual([
        "npm publish /release/tarballs/aokit-0.1.0-next.0.tgz --provenance --access public --tag next",
        "npm publish /release/tarballs/create-aokit-0.1.0-next.0.tgz --provenance --access public --tag next",
      ]);
    });
  });
});

describe("S2: one shared version released with bumpp", () => {
  test("aokit and create-aokit are at 0.1.0-next.0 and create-aokit pins that aokit", () => {
    const aokit = readJson("packages/aokit/package.json");
    const createAokit = readJson("packages/create-aokit/package.json");
    expect(aokit["version"]).toBe("0.1.0-next.0");
    expect(createAokit["version"]).toBe("0.1.0-next.0");
    expect(createAokit["dependencies"]).toEqual({ aokit: "0.1.0-next.0" });
  });

  test.each(["packages/aokit/package.json", "packages/create-aokit/package.json"])(
    "%s is ready for provenance: public, with its repository directory",
    (path) => {
      const manifest = readJson(path);
      expect(manifest["publishConfig"]).toEqual({ access: "public" });
      expect(manifest["repository"]).toEqual({
        type: "git",
        url: "git+https://github.com/andryorelabs/aokit.git",
        directory: path.replace("/package.json", ""),
      });
    },
  );

  test("bun run release runs bumpp over both manifests and release:notes runs changelogithub", () => {
    const scripts = asRecord(readJson("package.json")["scripts"], "scripts");
    expect(scripts["release"]).toBe("bumpp");
    expect(scripts["release:notes"]).toBe("changelogithub");
    expect(bumppConfig.files).toEqual([
      "packages/aokit/package.json",
      "packages/create-aokit/package.json",
    ]);
    expect(bumppConfig.preid).toBe("next");
  });
});
