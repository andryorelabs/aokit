import { afterAll, describe, expect, test } from "bun:test";
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
import { parseManifest } from "@aokit/module";
import { z } from "zod";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { parseAnswers, completeAnswers } from "../../src/project/answers.ts";
import { reproduceCommand } from "../../src/project/reproduce.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { parseJsonRecord, parseJsonText, parseLockfileJson } from "../helpers/registry-json.ts";
import { aokitCommand, spawnAokit as spawnAokitProcess } from "../helpers/aokit-process.ts";

/** These tests put a `#!/bin/sh` shim named `bun` on a `:`-joined PATH and send POSIX signals, neither of which exists on Windows. */
const posixShellTest = process.platform === "win32" ? test.skip : test;

const workspaces: string[] = [];

const envelopeSchema = z.looseObject({
  ok: z.boolean(),
  error: z.looseObject({ code: z.string(), message: z.string(), fix: z.string() }).nullable(),
  data: z
    .looseObject({
      applied: z.boolean().optional(),
      installed: z.boolean().optional(),
      modules: z.array(z.string()).optional(),
      reproduce: z.string().optional(),
      diff: z.string().optional(),
      plan: z
        .looseObject({
          changes: z.array(
            z.looseObject({
              path: z.string(),
              provenance: z.array(z.looseObject({ module: z.string() })).optional(),
            }),
          ),
        })
        .optional(),
      input: z.looseObject({ properties: z.record(z.string(), z.unknown()) }).optional(),
    })
    .nullable(),
});

function parseEnvelope(stdout: string) {
  return envelopeSchema.parse(parseJsonText(stdout));
}

function envelopeData(stdout: string) {
  const { data } = parseEnvelope(stdout);
  if (data === null) throw new Error("the envelope carries no data");
  return data;
}

function envelopeError(stdout: string) {
  const { error } = parseEnvelope(stdout);
  if (error === null) throw new Error("the envelope carries no error");
  return error;
}

afterAll(() => {
  for (const leftover of workspaces) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-create-"));
  workspaces.push(directory);
  return directory;
}

async function waitForFile(path: string, attempts: number): Promise<void> {
  if (attempts <= 0 || (await Bun.file(path).exists())) {
    return;
  }
  await Bun.sleep(50);
  await waitForFile(path, attempts - 1);
}

async function runAokit(argv: string[], env: Record<string, string | undefined> = {}) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    isTTY: false,
  };
  const exitCode = await runCli({
    argv,
    commands: exposedCommands,
    env: { ...process.env, ...env },
    version: cliVersion,
    io,
  });
  return { exitCode, stdout, stderr };
}

function spawnAokit(argv: string[], env: Record<string, string> = {}) {
  return spawnAokitProcess(argv, { env });
}

describe("aokit create", () => {
  test("creates a Project and prints exactly one sorted envelope", async () => {
    const parent = workspace();
    const target = join(parent, "app");
    const result = await runAokit([
      "create",
      target,
      "--layout",
      "single",
      "--modules",
      "oxc,vite-react",
      "--yes",
      "--json",
      "--no-install",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const rawEnvelope = parseJsonRecord(result.stdout);
    expect(Object.keys(rawEnvelope)).toEqual(["data", "error", "ok"]);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.error).toBeNull();
    expect(envelope.data?.applied).toBe(true);
    expect(envelope.data?.installed).toBe(false);
    expect(envelope.data?.modules).toEqual(["oxc", "vite-react"]);
    const rawData = z.record(z.string(), z.unknown()).parse(rawEnvelope["data"]);
    expect(Object.keys(rawData)).toEqual(Object.keys(rawData).toSorted());
    const lockfile = parseLockfileJson(readFileSync(join(target, "aokit.lock.json"), "utf8"));
    expect(Object.keys(lockfile.modules)).toEqual(["oxc", "vite-react"]);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
  });

  test("data.reproduce is the exact reproducing command", async () => {
    const result = await runAokit([
      "create",
      "app",
      "--modules",
      "vite-react,oxc",
      "--dry-run",
      "--no-install",
      "--json",
    ]);
    expect(envelopeData(result.stdout).reproduce).toBe(
      "aokit create app --layout single --modules oxc,vite-react --no-install --yes",
    );
  });

  test("a direct run equals the adapter result", async () => {
    const parent = workspace();
    const viaAdapter = await runAokit([
      "create",
      join(parent, "a"),
      "--modules",
      "oxc",
      "--dry-run",
      "--json",
    ]);
    const direct = await runCommand(
      createCommand,
      { version: cliVersion, env: {}, commands: exposedCommands },
      { directory: join(parent, "a"), modules: "oxc", dryRun: true },
    );
    if (!direct.ok) throw new Error(direct.error.message);
    expect(direct.data).toMatchObject({ plan: envelopeData(viaAdapter.stdout).plan });
  });

  test("a non-empty target exits 3 and stays unchanged; an empty one is used", async () => {
    const parent = workspace();
    const target = join(parent, "app");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "mine");
    const refused = await runAokit(["create", target, "--modules", "oxc", "--yes", "--json"]);
    expect(refused.exitCode).toBe(3);
    const refusal = envelopeError(refused.stdout);
    expect(refusal.code).toBe("INVALID_INPUT");
    expect(refusal.message).toContain("not empty");
    expect(refusal.fix).toContain("choose another directory");
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("mine");

    const dryRun = await runAokit(["create", target, "--modules", "oxc", "--dry-run", "--json"]);
    expect(dryRun.exitCode).toBe(3);

    const empty = join(parent, "empty");
    mkdirSync(empty);
    const used = await runAokit(["create", empty, "--modules", "oxc", "--json", "--no-install"]);
    expect(used.exitCode).toBe(0);
    expect(readFileSync(join(empty, "aokit.lock.json"), "utf8")).toContain("oxc");
  });

  test("--dry-run lists changes with Provenance and writes nothing", async () => {
    const parent = workspace();
    const target = join(parent, "app");
    const result = await runAokit([
      "create",
      target,
      "--modules",
      "oxc,vite-react",
      "--dry-run",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const data = envelopeData(result.stdout);
    expect(data.applied).toBe(false);
    const manifest = data.plan?.changes.find((change) => change.path === "package.json");
    expect(manifest?.provenance?.map((entry) => entry.module)).toContain("oxc");
    expect(await Bun.file(join(target, "aokit.lock.json")).exists()).toBe(false);
  });

  test("--diff implies --dry-run and prints unified diffs", async () => {
    const parent = workspace();
    const target = join(parent, "app");
    const result = await runAokit(["create", target, "--modules", "oxc", "--diff", "--json"]);
    expect(result.exitCode).toBe(0);
    const data = envelopeData(result.stdout);
    expect(data.applied).toBe(false);
    expect(data.diff).toContain("--- /dev/null\n+++ b/.oxlintrc.json\n@@ -0,0 +1,");
    expect(await Bun.file(join(target, "aokit.lock.json")).exists()).toBe(false);
  });

  test("a Resolver error exits 4 with its code, message and fix", async () => {
    const result = await runAokit(["create", "app", "--modules", "tailwind4", "--json"]);
    expect(result.exitCode).toBe(4);
    const error = envelopeError(result.stdout);
    expect(error.code).toBe("REQUIREMENT_UNMET");
    expect(error.message).toContain("[requirement_ambiguous]");
    expect(error.fix.length).toBeGreaterThan(0);
  });

  test("missing modules exits 3 naming the flag", async () => {
    const result = await runAokit(["create", "app", "--yes", "--json"]);
    expect(result.exitCode).toBe(3);
    expect(envelopeError(result.stdout)).toMatchObject({ code: "MISSING_VALUE" });
    expect(envelopeError(result.stdout).message).toContain("--modules");
  });

  test.each([
    ["malformed", "oops"],
    ["unselected", "vite-react.name=x"],
  ])("a %s --answer exits 3", async (_label, answer) => {
    const result = await runAokit([
      "create",
      "app",
      "--modules",
      "oxc",
      "--answer",
      answer,
      "--dry-run",
      "--json",
    ]);
    expect(result.exitCode).toBe(3);
    expect(envelopeError(result.stdout).code).toBe("INVALID_INPUT");
  });

  posixShellTest(
    "a failed install leaves the Project, exits 1 and says to rerun bun install",
    async () => {
      const parent = workspace();
      const fakeBin = join(parent, "bin");
      mkdirSync(fakeBin);
      writeFileSync(join(fakeBin, "bun"), "#!/bin/sh\necho boom >&2\nexit 7\n");
      chmodSync(join(fakeBin, "bun"), 0o755);
      const target = join(parent, "app");
      const result = await spawnAokit(["create", target, "--modules", "oxc", "--json"], {
        PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
      });
      expect(result.exitCode).toBe(1);
      const { fix } = envelopeError(result.stdout);
      expect(fix).toContain("bun install");
      expect(readFileSync(join(target, "aokit.lock.json"), "utf8")).toContain("oxc");
    },
  );

  posixShellTest("SIGINT during install exits 130", async () => {
    const parent = workspace();
    const fakeBin = join(parent, "bin");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "bun"), "#!/bin/sh\nexec sleep 30\n");
    chmodSync(join(fakeBin, "bun"), 0o755);
    const child = Bun.spawn(
      [...aokitCommand(), "create", join(parent, "app"), "--modules", "oxc", "--json"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: `${fakeBin}:${process.env["PATH"] ?? ""}` },
      },
    );
    await waitForFile(join(parent, "app", "aokit.lock.json"), 200);
    await Bun.sleep(300);
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(await Bun.file(join(parent, "app", "aokit.lock.json")).exists()).toBe(true);
  });

  test("human --diff prints raw unified diffs and --dry-run prints a change list", async () => {
    const parent = workspace();
    const diff = await runAokit(["create", join(parent, "a"), "--modules", "oxc", "--diff"]);
    expect(diff.exitCode).toBe(0);
    expect(diff.stdout).toContain("--- /dev/null\n+++ b/.oxlintrc.json\n@@ -0,0 +1,");
    expect(diff.stdout.trimStart().startsWith("{")).toBe(false);
    const dryRun = await runAokit(["create", join(parent, "b"), "--modules", "oxc", "--dry-run"]);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain("create package.json (");
    expect(dryRun.stdout.trimStart().startsWith("{")).toBe(false);
  });

  test("--version prints the package version and schema create prints the input schema", async () => {
    const version = await spawnAokit(["--version"]);
    expect(version.stdout).toBe(`${cliVersion}\n`);
    const schema = await runAokit(["schema", "create", "--json"]);
    const data = envelopeData(schema.stdout);
    expect(Object.keys(data.input?.properties ?? {})).toContain("modules");
  });
});

describe("answers", () => {
  const demo = parseManifest({
    name: "demo",
    version: "1.0.0",
    description: "Fixture Module.",
    answers: {
      flag: { type: "boolean" },
      count: { type: "number", default: 2 },
      kind: { type: "select", choices: ["a", "b"] },
    },
  });
  const modules = [demo];

  test("coerces by declared type and rejects bad values", () => {
    expect(parseAnswers(["demo.flag=true", "demo.count=5", "demo.kind=a"], modules)).toEqual({
      demo: { flag: true, count: 5, kind: "a" },
    });
    expect(() => parseAnswers(["demo.flag=yes"], modules)).toThrow("true or false");
    expect(() => parseAnswers(["demo.kind=z"], modules)).toThrow("one of a, b");
    expect(() => parseAnswers(["demo.nope=1"], modules)).toThrow("no answer");
  });

  test("a missing value with no default names the flag", () => {
    expect(() => completeAnswers({}, modules)).toThrow("--answer demo.flag");
    expect(completeAnswers({ demo: { flag: false, kind: "b" } }, modules)).toEqual({
      demo: { flag: false, count: 2, kind: "b" },
    });
  });
});

describe("reproduceCommand", () => {
  test("quotes unsafe values and keeps answers explicit and sorted", () => {
    expect(
      reproduceCommand({
        directory: "my app",
        layout: "monorepo",
        modules: ["b", "a"],
        answers: { a: { z: "x y", k: true } },
        registry: "./reg",
        install: true,
      }),
    ).toBe(
      "aokit create 'my app' --layout monorepo --modules a,b --answer a.k=true --answer 'a.z=x y' --registry ./reg --yes",
    );
  });

  test("create --modules vite-react renders src/router.tsx from vite-react 1.3.0", async () => {
    const target = join(workspace(), "app");
    const result = await runAokit([
      "create",
      target,
      "--modules",
      "vite-react",
      "--yes",
      "--no-install",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(target, "src", "router.tsx"), "utf8")).toContain("routes");
    expect(readFileSync(join(target, "src", "main.tsx"), "utf8")).toContain('from "./router"');
    expect(existsSync(join(target, "src", "routes.tsx"))).toBe(false);
    expect(readFileSync(join(target, "aokit.lock.json"), "utf8")).toContain('"version": "1.3.0"');
  });
});
