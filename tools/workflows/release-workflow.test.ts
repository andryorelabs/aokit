import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBumpConfig } from "bumpp";
import bumppConfig from "../../bump.config.ts";
import { parseBinaryTarget } from "../build-binary/targets.ts";

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

  test("verify runs first, then binaries, then the GitHub Release, and publish runs last", () => {
    expect(Object.keys(jobs)).toEqual(["verify", "binaries", "release", "publish"]);
    expect(job("binaries")["needs"]).toBe("verify");
    expect(job("release")["needs"]).toEqual(["verify", "binaries"]);
    expect(job("publish")["needs"]).toEqual(["verify", "binaries", "release"]);
  });

  test("the workflow is read-only; only release and publish get id-token, only release writes", () => {
    expect(workflow["permissions"]).toEqual({ contents: "read" });
    expect(job("publish")["permissions"]).toEqual({ contents: "read", "id-token": "write" });
    expect(job("release")["permissions"]).toEqual({
      contents: "write",
      "id-token": "write",
      attestations: "write",
    });
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
    for (const name of ["verify", "binaries", "release"]) {
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

const releasedBinaries = [
  "aokit-darwin-arm64",
  "aokit-darwin-x64",
  "aokit-linux-arm64",
  "aokit-linux-x64",
  "aokit-windows-x64.exe",
];
const untestedSentence = "The Windows and darwin-x64 binaries were not tested end to end.";

interface MatrixEntry {
  target: string;
  artifact: string;
  runner: string;
  tested: boolean;
}

function binaryMatrix(): MatrixEntry[] {
  const strategy = asRecord(job("binaries")["strategy"], "binaries strategy");
  const include = asRecord(strategy["matrix"], "binaries matrix")["include"];
  if (!Array.isArray(include)) throw new Error("binaries matrix has no include list");
  return include.map((entry, index) => {
    const record = asRecord(entry, `matrix entry ${index + 1}`);
    const { target, artifact, runner, tested } = record;
    if (
      typeof target !== "string" ||
      typeof artifact !== "string" ||
      typeof runner !== "string" ||
      typeof tested !== "boolean"
    ) {
      throw new Error(`matrix entry ${index + 1} needs target, artifact, runner and tested`);
    }
    return { target, artifact, runner, tested };
  });
}

function stepNamed(jobName: string, name: string): Record<string, unknown> {
  const step = steps(jobName).find((candidate) => candidate["name"] === name);
  if (step === undefined) throw new Error(`${jobName} has no "${name}" step`);
  return step;
}

function stepUsing(jobName: string, action: string): Record<string, unknown>[] {
  return steps(jobName).filter(
    (step) => typeof step["uses"] === "string" && step["uses"].startsWith(`${action}@`),
  );
}

/** Runs the `Write SHA256SUMS` step over a directory holding `files`, each containing its own name. */
function writeChecksums(files: readonly string[]): ScriptResult & { sums: string } {
  const directory = temporaryDirectory();
  for (const file of files) writeFileSync(join(directory, file), `${file}\n`);
  const result = runBash(runScript("release", "Write SHA256SUMS"), directory, {
    ASSETS_DIR: directory,
  });
  const sumsFile = join(directory, "SHA256SUMS");
  return { ...result, sums: existsSync(sumsFile) ? readFileSync(sumsFile, "utf8") : "" };
}

interface ReleaseRun {
  assets: string;
  calls: string[];
}

/** Runs the `Create the GitHub Release` step with a fake `gh` and returns each recorded call. */
function releaseCalls(dryRun: string, distTag: string): ReleaseRun {
  const directory = temporaryDirectory();
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  const callLog = join(directory, "gh-calls");
  const fakeGh = join(binDirectory, "gh");
  writeFileSync(fakeGh, `#!/usr/bin/env bash\necho "gh $*" >> "${callLog}"\n`);
  chmodSync(fakeGh, 0o755);
  writeFileSync(callLog, "");
  const assets = join(directory, "assets");
  mkdirSync(assets);
  for (const file of [...releasedBinaries, "SHA256SUMS"]) writeFileSync(join(assets, file), "");
  const result = runBash(runScript("release", "Create the GitHub Release"), directory, {
    PATH: `${binDirectory}:${process.env["PATH"] ?? ""}`,
    GITHUB_REPOSITORY: "andryorelabs/aokit",
    VERSION: "0.1.0-next.0",
    DIST_TAG: distTag,
    DRY_RUN: dryRun,
    ASSETS_DIR: assets,
    NOTES_FILE: "/notes.md",
  });
  expect(result.exitCode).toBe(0);
  return { assets, calls: readFileSync(callLog, "utf8").split("\n").filter(Boolean) };
}

describe("S3: release binaries, SHA256SUMS and attestations", () => {
  test("the matrix builds the five targets, each named as build:binary names its output", () => {
    const matrix = binaryMatrix();
    expect(matrix.map((entry) => entry.target).toSorted()).toEqual([
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-linux-arm64",
      "bun-linux-x64",
      "bun-windows-x64",
    ]);
    for (const entry of matrix) {
      expect(entry.artifact).toBe(parseBinaryTarget(entry.target).outputName);
    }
    expect(matrix.map((entry) => entry.artifact).toSorted()).toEqual(releasedBinaries);
  });

  test("linux-x64, linux-arm64 and darwin-arm64 are tested on native runners; the rest are not", () => {
    const tested = binaryMatrix()
      .filter((entry) => entry.tested)
      .map((entry) => [entry.artifact, entry.runner]);
    expect(tested).toEqual([
      ["aokit-linux-x64", "ubuntu-latest"],
      ["aokit-linux-arm64", "ubuntu-24.04-arm"],
      ["aokit-darwin-arm64", "macos-latest"],
    ]);
    expect(job("binaries")["runs-on"]).toBe("${{ matrix.runner }}");
  });

  test("each binary job builds its target and runs the process and e2e tests only when tested", () => {
    expect(runScript("binaries", "Build binary")).toContain(
      'bun run build:binary -- --target "$TARGET"',
    );
    expect(stepNamed("binaries", "Build binary")["env"]).toEqual({
      TARGET: "${{ matrix.target }}",
      ARTIFACT: "${{ matrix.artifact }}",
    });
    const processTests = stepNamed("binaries", "Process tests against the binary");
    expect(processTests["if"]).toBe("matrix.tested");
    expect(processTests["run"]).toBe("bun test packages/aokit/test");
    const endToEnd = stepNamed("binaries", "End-to-end and digest comparison");
    expect(endToEnd["if"]).toBe("matrix.tested");
    expect(endToEnd["run"]).toContain("bun test packages/aokit/test/dist/e2e");
    const [upload] = stepUsing("binaries", "actions/upload-artifact");
    expect(asRecord(upload?.["with"], "upload inputs")).toMatchObject({
      name: "${{ matrix.artifact }}",
      path: "dist/bin/${{ matrix.artifact }}",
      "if-no-files-found": "error",
    });
  });

  test("the release job collects every binary artifact into one directory", () => {
    const [binaries] = stepUsing("release", "actions/download-artifact");
    expect(asRecord(binaries?.["with"], "download inputs")).toEqual({
      pattern: "aokit-*",
      "merge-multiple": true,
      path: "${{ runner.temp }}/assets",
    });
  });

  test("SHA256SUMS is sorted, covers exactly the five binaries and checks out", () => {
    const result = writeChecksums(releasedBinaries.toReversed());
    expect(result.exitCode).toBe(0);
    const lines = result.sums.trimEnd().split("\n");
    expect(lines.map((line) => line.split(/\s+/)[1])).toEqual(releasedBinaries);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64} {2}aokit-/);
    expect(result.output).toContain("aokit-linux-x64: OK");
  });

  test.each([
    ["a missing binary", releasedBinaries.slice(1)],
    ["an extra file", [...releasedBinaries, "aokit-linux-x64-musl"]],
  ])("SHA256SUMS fails with %s", (_label, files) => {
    const result = writeChecksums(files);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("expected exactly the binaries");
    expect(result.sums).toBe("");
  });

  test("each binary gets a provenance attestation from SHA256SUMS on a real release", () => {
    const [attest] = stepUsing("release", "actions/attest-build-provenance");
    expect(attest?.["if"]).toBe("needs.verify.outputs.dry-run == 'false'");
    expect(attest?.["with"]).toEqual({
      "subject-checksums": "${{ runner.temp }}/assets/SHA256SUMS",
    });
  });

  test("the release notes carry the verification steps and the untested-binaries sentence", () => {
    const directory = temporaryDirectory();
    const notesFile = join(directory, "release-notes.md");
    writeFileSync(notesFile, "## Features\n");
    const result = runBash(
      runScript("release", "Add verification steps to the release notes"),
      directory,
      { NOTES_FILE: notesFile, REPOSITORY: "andryorelabs/aokit" },
    );
    expect(result.exitCode).toBe(0);
    const notes = readFileSync(notesFile, "utf8");
    expect(notes).toStartWith("## Features\n");
    expect(notes).toContain("sha256sum -c SHA256SUMS");
    expect(notes).toContain("gh attestation verify aokit-linux-x64 --repo andryorelabs/aokit");
    expect(notes).toContain(untestedSentence);
  });

  test.each(["true", "", "False"])('DRY_RUN "%s" never creates the GitHub Release', (dryRun) => {
    expect(releaseCalls(dryRun, "next").calls).toEqual([]);
  });

  test.each([
    ["next", " --prerelease"],
    ["latest", ""],
  ])("a real release under %s attaches the binaries and SHA256SUMS", (distTag, prerelease) => {
    const { assets, calls } = releaseCalls("false", distTag);
    const attached = [...releasedBinaries, "SHA256SUMS"].map((file) => join(assets, file));
    expect(calls).toEqual([
      `gh release create v0.1.0-next.0 ${attached.join(" ")} --repo andryorelabs/aokit --title v0.1.0-next.0 --notes-file /notes.md --verify-tag${prerelease}`,
    ]);
  });

  test("the dry run still uploads the binaries, SHA256SUMS and notes as an artifact", () => {
    const uploads = stepUsing("release", "actions/upload-artifact");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.["if"]).toBeUndefined();
    expect(asRecord(uploads[0]?.["with"], "upload inputs")["name"]).toBe("release-assets");
  });
});

describe("S2: one shared version released with bumpp", () => {
  test("aokit and create-aokit share one next pre-release version and create-aokit pins that aokit", () => {
    const aokit = readJson("packages/aokit/package.json");
    const createAokit = readJson("packages/create-aokit/package.json");
    expect(aokit["version"]).toMatch(/^\d+\.\d+\.\d+-next\.\d+$/);
    expect(createAokit["version"]).toBe(aokit["version"]);
    expect(createAokit["dependencies"]).toEqual({ aokit: aokit["version"] });
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

  test("bumpp itself loads the repository config, so bun run release uses it", async () => {
    const loaded = await loadBumpConfig(undefined, repositoryRoot);
    expect(loaded.files).toEqual(bumppConfig.files);
    expect(loaded.preid).toBe("next");
    expect(loaded.pr).toEqual(bumppConfig.pr);
    expect(typeof loaded.execute).toBe("function");
  });
});
