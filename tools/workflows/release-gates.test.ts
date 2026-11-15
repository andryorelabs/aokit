import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseWorkflowPath = join(
  import.meta.dir,
  "..",
  "..",
  ".github",
  "workflows",
  "release.yml",
);
const signedTagStepName = "Tag is annotated and signed";
const binarySizeStepName = "Write the binary size to the step summary";
const attachSbomStepName = "Attach the SBOM to the GitHub Release";
const sbomAction = "anchore/sbom-action@66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c";
const gateTimeout = 30_000;

/**
 * Skipped on Windows: these run release.yml `run:` scripts, which only ever run on Linux runners,
 * through bash with a colon-joined POSIX PATH and fake shebang executables Windows cannot exec.
 */
const bashStepTest = test.skipIf(process.platform === "win32");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not a mapping`);
  return value;
}

const workflow = asRecord(Bun.YAML.parse(readFileSync(releaseWorkflowPath, "utf8")), "release.yml");
const jobs = asRecord(workflow["jobs"], "jobs");

function steps(jobName: string): Record<string, unknown>[] {
  const list = asRecord(jobs[jobName], `job ${jobName}`)["steps"];
  if (!Array.isArray(list)) throw new Error(`job ${jobName} has no steps`);
  return list.map((step, index) => asRecord(step, `${jobName} step ${index + 1}`));
}

function stepNamed(jobName: string, stepName: string): Record<string, unknown> {
  const step = steps(jobName).find((candidate) => candidate["name"] === stepName);
  if (step === undefined) throw new Error(`${jobName} has no "${stepName}" step`);
  return step;
}

function runScript(jobName: string, stepName: string): string {
  const run = stepNamed(jobName, stepName)["run"];
  if (typeof run !== "string") throw new Error(`${jobName} "${stepName}" has no run script`);
  return run;
}

/** The index of the first step whose `run:` or `uses:` contains `fragment`. */
function firstStepIndex(jobName: string, fragment: string): number {
  return steps(jobName).findIndex((step) =>
    [step["run"], step["uses"]].some(
      (value) => typeof value === "string" && value.includes(fragment),
    ),
  );
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-release-gates-"));
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

const gitIdentity = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "release test",
  GIT_AUTHOR_EMAIL: "release-test@example.invalid",
  GIT_COMMITTER_NAME: "release test",
  GIT_COMMITTER_EMAIL: "release-test@example.invalid",
};

function runChecked(script: string, cwd: string): string {
  const result = runBash(script, cwd, gitIdentity);
  if (result.exitCode !== 0) throw new Error(`setup failed: ${result.output}`);
  return result.output.trim();
}

type TagKind = "signed" | "signed by another key" | "annotated" | "lightweight";

interface TagScenario {
  kind: TagKind;
  refType?: "tag" | "branch";
  /** Simulates actions/checkout rewriting the fetched annotated tag as a lightweight tag. */
  checkoutRewritesTag?: boolean;
  /** Moves the tag to a later commit than the one the workflow runs for. */
  tagMovedAway?: boolean;
}

interface SignedTagGateResult extends ScriptResult {
  ghCalls: string[];
}

function generateKey(directory: string, name: string): string {
  const keyPath = join(directory, name);
  runChecked(`ssh-keygen -q -t ed25519 -N "" -C ${name} -f "${keyPath}"`, directory);
  return keyPath;
}

/** Writes a fake `gh` that lists `registeredKey` as the actor's SSH signing key and no GPG key. */
function writeFakeGh(directory: string, registeredKey: string, callLog: string): string {
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  const fakeGh = join(binDirectory, "gh");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
echo "gh $*" >> "${callLog}"
case "$*" in
  *ssh_signing_keys*) cut -d " " -f 1,2 "${registeredKey}.pub" ;;
  *gpg_keys*) ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(fakeGh, 0o755);
  return binDirectory;
}

/**
 * Tags a commit in an upstream repository as `scenario` says, clones it the way the verify job
 * checks out, then runs the signed tag gate in the clone.
 */
function runSignedTagGate(scenario: TagScenario): SignedTagGateResult {
  const directory = temporaryDirectory();
  const releaseKey = generateKey(directory, "release-key");
  const otherKey = generateKey(directory, "other-key");
  const upstream = join(directory, "upstream");
  mkdirSync(upstream);
  const signingKey = scenario.kind === "signed by another key" ? otherKey : releaseKey;
  const tagCommand = {
    signed: `git -c gpg.format=ssh -c user.signingkey="${signingKey}" tag -s v0.2.0 -m v0.2.0`,
    "signed by another key": `git -c gpg.format=ssh -c user.signingkey="${signingKey}" tag -s v0.2.0 -m v0.2.0`,
    annotated: "git tag -a v0.2.0 -m v0.2.0",
    lightweight: "git tag v0.2.0",
  }[scenario.kind];
  const releasedSha = runChecked(
    `git init -q -b main
git commit -q --allow-empty -m first
${tagCommand}
git rev-parse HEAD`,
    upstream,
  )
    .split("\n")
    .at(-1);
  if (scenario.tagMovedAway === true) {
    runChecked(
      `git commit -q --allow-empty -m second
git tag -d v0.2.0 >/dev/null
${tagCommand}`,
      upstream,
    );
  }
  const clone = join(directory, "clone");
  runChecked(`git clone -q "${upstream}" "${clone}"`, directory);
  if (scenario.checkoutRewritesTag === true) {
    runChecked(`git tag -f v0.2.0 "${releasedSha ?? ""}" >/dev/null`, clone);
  }
  const callLog = join(directory, "gh-calls");
  writeFileSync(callLog, "");
  const binDirectory = writeFakeGh(directory, releaseKey, callLog);
  const runnerTemp = join(directory, "runner-temp");
  mkdirSync(runnerTemp);
  const refType = scenario.refType ?? "tag";
  const result = runBash(runScript("verify", signedTagStepName), clone, {
    ...gitIdentity,
    PATH: `${binDirectory}:${process.env["PATH"] ?? ""}`,
    GH_TOKEN: "test-token",
    RUNNER_TEMP: runnerTemp,
    REF_TYPE: refType,
    REF_NAME: refType === "tag" ? "v0.2.0" : "main",
    TAG_SHA: releasedSha ?? "",
    ACTOR: "release-maintainer",
  });
  return { ...result, ghCalls: readFileSync(callLog, "utf8").split("\n").filter(Boolean) };
}

describe("S6: a release tag is annotated and signed", () => {
  test("the signed tag gate runs in verify before any check, test or build step", () => {
    const gate = steps("verify").findIndex((step) => step["name"] === signedTagStepName);
    expect(gate).toBeGreaterThan(firstStepIndex("verify", "bun install"));
    for (const buildStep of ["bun run check", "bun run test", "bun run build:package"]) {
      expect(gate).toBeLessThan(firstStepIndex("verify", buildStep));
    }
    expect(asRecord(jobs["binaries"], "binaries")["needs"]).toBe("verify");
  });

  test("the gate reads the tag, commit and actor through env", () => {
    expect(stepNamed("verify", signedTagStepName)["env"]).toEqual({
      GH_TOKEN: "${{ github.token }}",
      REF_TYPE: "${{ github.ref_type }}",
      REF_NAME: "${{ github.ref_name }}",
      TAG_SHA: "${{ github.sha }}",
      ACTOR: "${{ github.actor }}",
    });
  });

  test("the verify job keeps its read-only permissions", () => {
    expect(asRecord(jobs["verify"], "verify")["permissions"]).toEqual({
      contents: "read",
      checks: "read",
    });
  });

  describe.skipIf(process.platform === "win32")("the gate", () => {
    test(
      "passes a tag signed with a signing key the actor registered on GitHub",
      () => {
        const result = runSignedTagGate({ kind: "signed" });
        expect(result.output).toContain("tag v0.2.0 is annotated and signed");
        expect(result.exitCode).toBe(0);
        expect(result.ghCalls).toContain(
          "gh api users/release-maintainer/ssh_signing_keys --jq .[].key",
        );
      },
      gateTimeout,
    );

    test(
      "passes when the checkout rewrote the annotated tag as a lightweight one",
      () => {
        const result = runSignedTagGate({ kind: "signed", checkoutRewritesTag: true });
        expect(result.output).toContain("tag v0.2.0 is annotated and signed");
        expect(result.exitCode).toBe(0);
      },
      gateTimeout,
    );

    test(
      "fails a lightweight tag before any signature check",
      () => {
        const result = runSignedTagGate({ kind: "lightweight" });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("::error::tag v0.2.0 is a lightweight tag");
        expect(result.ghCalls).toEqual([]);
      },
      gateTimeout,
    );

    test(
      "fails an annotated tag without a signature",
      () => {
        const result = runSignedTagGate({ kind: "annotated" });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("::error::tag v0.2.0 has no valid signature");
      },
      gateTimeout,
    );

    test(
      "fails a tag signed with a key the actor did not register",
      () => {
        const result = runSignedTagGate({ kind: "signed by another key" });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("::error::tag v0.2.0 has no valid signature");
      },
      gateTimeout,
    );

    test(
      "fails a tag that now points to another commit than the released one",
      () => {
        const result = runSignedTagGate({ kind: "signed", tagMovedAway: true });
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("::error::tag v0.2.0 points to");
      },
      gateTimeout,
    );

    test(
      "skips a dispatch without a tag and never calls gh",
      () => {
        const result = runSignedTagGate({ kind: "lightweight", refType: "branch" });
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("No tag");
        expect(result.ghCalls).toEqual([]);
      },
      gateTimeout,
    );
  });
});

describe("S6: each binary's size is in the step summary", () => {
  test("the size step runs right after the build, for the artifact the build wrote", () => {
    const names = steps("binaries").map((step) => step["name"]);
    expect(names.indexOf(binarySizeStepName)).toBe(names.indexOf("Build binary") + 1);
    expect(stepNamed("binaries", binarySizeStepName)["env"]).toEqual({
      ARTIFACT: "${{ matrix.artifact }}",
    });
  });

  bashStepTest("writes the artifact name, bytes and MiB as a table row", () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "dist", "bin"), { recursive: true });
    writeFileSync(join(directory, "dist", "bin", "aokit-linux-x64"), Buffer.alloc(3 * 1_048_576));
    const summary = join(directory, "summary.md");
    writeFileSync(summary, "");
    const result = runBash(runScript("binaries", binarySizeStepName), directory, {
      ARTIFACT: "aokit-linux-x64",
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(summary, "utf8")).toBe(
      "### Binary size\n\n| Binary | Bytes | MiB |\n| --- | ---: | ---: |\n| aokit-linux-x64 | 3145728 | 3.0 |\n",
    );
  });

  bashStepTest("fails when the binary is missing", () => {
    const directory = temporaryDirectory();
    const summary = join(directory, "summary.md");
    writeFileSync(summary, "");
    const result = runBash(runScript("binaries", binarySizeStepName), directory, {
      ARTIFACT: "aokit-linux-x64",
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(result.exitCode).not.toBe(0);
  });
});

describe("S7: the release attaches an SBOM", () => {
  test("verify writes an SPDX SBOM into the release artifact after packing, without uploading it itself", () => {
    const sbom = steps("verify").find(
      (step) => typeof step["uses"] === "string" && step["uses"].startsWith(sbomAction),
    );
    expect(sbom?.["with"]).toEqual({
      path: ".",
      format: "spdx-json",
      "output-file": "${{ runner.temp }}/release/sbom.spdx.json",
      "upload-artifact": false,
      "upload-release-assets": false,
    });
    const sbomIndex = firstStepIndex("verify", sbomAction);
    expect(sbomIndex).toBeGreaterThan(firstStepIndex("verify", "bun pm pack"));
    expect(sbomIndex).toBeLessThan(firstStepIndex("verify", "actions/upload-artifact@"));
  });

  test("the release job attaches it after creating the GitHub Release, on a real release only", () => {
    const names = steps("release").map((step) => step["name"]);
    expect(names.indexOf(attachSbomStepName)).toBe(names.indexOf("Create the GitHub Release") + 1);
    const attach = stepNamed("release", attachSbomStepName);
    expect(attach["if"]).toBe("needs.verify.outputs.dry-run == 'false'");
    expect(attach["env"]).toEqual({
      GH_TOKEN: "${{ github.token }}",
      VERSION: "${{ needs.verify.outputs.version }}",
      SBOM_FILE: "${{ runner.temp }}/release/sbom.spdx.json",
    });
  });

  bashStepTest("uploads the SBOM to the release of the version", () => {
    const directory = temporaryDirectory();
    const binDirectory = join(directory, "bin");
    mkdirSync(binDirectory);
    const callLog = join(directory, "gh-calls");
    writeFileSync(callLog, "");
    const fakeGh = join(binDirectory, "gh");
    writeFileSync(fakeGh, `#!/usr/bin/env bash\necho "gh $*" >> "${callLog}"\n`);
    chmodSync(fakeGh, 0o755);
    const result = runBash(runScript("release", attachSbomStepName), directory, {
      PATH: `${binDirectory}:${process.env["PATH"] ?? ""}`,
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: "andryorelabs/aokit",
      VERSION: "0.2.0",
      SBOM_FILE: "/release/sbom.spdx.json",
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(callLog, "utf8")).toBe(
      "gh release upload v0.2.0 /release/sbom.spdx.json --repo andryorelabs/aokit\n",
    );
  });

  test("the release-assets artifact keeps the SBOM for dry runs", () => {
    const upload = steps("release").find(
      (step) =>
        typeof step["uses"] === "string" && step["uses"].startsWith("actions/upload-artifact@"),
    );
    const inputs = asRecord(upload?.["with"], "upload inputs");
    expect(String(inputs["path"])).toContain("${{ runner.temp }}/release/sbom.spdx.json");
  });
});
