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
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { Vfs } from "../../src/engine/index.ts";
import { hashVfs, type Plan } from "../../src/engine/plan.ts";
import { initialCommitMessage } from "../../src/create/git.ts";
import { renderProjectReadme, withProjectReadme } from "../../src/create/readme.ts";
import { parseJsonRecord } from "../helpers/registry-json.ts";

const posixShellTest = process.platform === "win32" ? test.skip : test;
const workspaces: string[] = [];

afterAll(() => {
  for (const leftover of workspaces) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-git-readme-"));
  workspaces.push(directory);
  return directory;
}

/** A `bun` that writes a `bun.lock` and a `node_modules` tree, like a real install. */
function fakeBun(parent: string): string {
  const bin = join(parent, "bin");
  mkdirSync(bin);
  const shim = join(bin, "bun");
  writeFileSync(
    shim,
    "#!/bin/sh\nmkdir -p node_modules/pkg\necho x > node_modules/pkg/index.js\necho lock > bun.lock\n",
  );
  chmodSync(shim, 0o755);
  return bin;
}

function isolatedGitEnv(parent: string): Record<string, string> {
  return {
    HOME: parent,
    GIT_CONFIG_GLOBAL: join(parent, "no-global-config"),
    GIT_CONFIG_SYSTEM: join(parent, "no-system-config"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

async function runAokit(argv: string[], env: Record<string, string | undefined>) {
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

function git(directory: string, env: Record<string, string>, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: directory,
    env: { ...process.env, ...env },
  });
  return result.stdout.toString().trim();
}

describe("create git init", () => {
  posixShellTest("makes exactly one commit that includes bun.lock", async () => {
    const parent = workspace();
    const env = { ...isolatedGitEnv(parent), PATH: `${fakeBun(parent)}:${process.env["PATH"]}` };
    const target = join(parent, "app");
    const result = await runAokit(["create", target, "--modules", "oxc", "--yes", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(git(target, env, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(target, env, "ls-tree", "-r", "HEAD", "--name-only").split("\n")).toContain(
      "bun.lock",
    );
    expect(git(target, env, "ls-tree", "-r", "HEAD", "--name-only")).not.toContain("node_modules");
    expect(git(target, env, "log", "-1", "--format=%s")).toBe(initialCommitMessage);
    expect(git(target, env, "status", "--porcelain")).toBe("");
    expect(existsSync(join(parent, "no-global-config"))).toBe(false);
  });

  posixShellTest("--no-git leaves no .git", async () => {
    const parent = workspace();
    const env = { ...isolatedGitEnv(parent), PATH: `${fakeBun(parent)}:${process.env["PATH"]}` };
    const target = join(parent, "app");
    const result = await runAokit(["create", target, "--modules", "oxc", "--yes", "--no-git"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(target, ".git"))).toBe(false);
  });

  posixShellTest("skips with a warning when git is missing from PATH", async () => {
    const parent = workspace();
    const env = { ...isolatedGitEnv(parent), PATH: fakeBun(parent) };
    const target = join(parent, "app");
    const result = await runAokit(["create", target, "--modules", "oxc", "--yes", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(target, ".git"))).toBe(false);
    const envelope = parseJsonRecord(result.stdout);
    expect(JSON.stringify(envelope["data"])).toContain("git is not installed");
  });

  posixShellTest("skips with a warning inside an existing work tree", async () => {
    const parent = workspace();
    const env = { ...isolatedGitEnv(parent), PATH: `${fakeBun(parent)}:${process.env["PATH"]}` };
    git(parent, env, "init");
    const target = join(parent, "app");
    const result = await runAokit(["create", target, "--modules", "oxc", "--yes", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(target, ".git"))).toBe(false);
    expect(JSON.stringify(parseJsonRecord(result.stdout)["data"])).toContain("git work tree");
  });
});

describe("create README", () => {
  test("lists the Modules and the scripts of package.json", async () => {
    const parent = workspace();
    const target = join(parent, "app");
    const result = await runAokit(
      ["create", target, "--modules", "next,tailwind4,oxc", "--yes", "--no-install", "--no-git"],
      {},
    );
    expect(result.exitCode).toBe(0);
    const readme = readFileSync(join(target, "README.md"), "utf8");
    expect(readme).toContain("# app");
    for (const name of ["next", "tailwind4", "oxc"]) {
      expect(readme).toContain(`- \`${name}\``);
    }
    expect(readme).toContain("`bun run dev`");
    expect(readme).toContain("aokit update");
    expect(readme).toContain("aokit check");
    const lockfile = readFileSync(join(target, "aokit.lock.json"), "utf8");
    expect(lockfile).not.toContain("README.md");
  });

  test("never overwrites a README a Module provides", () => {
    const vfs = Vfs.empty();
    vfs.write("README.md", "from a module\n");
    const plan: Plan = { changes: [], hash: hashVfs(vfs), vfs };
    expect(withProjectReadme(plan, "/tmp/app", [])).toBe(plan);
  });

  test("is deterministic", () => {
    const input = {
      name: "app",
      modules: [
        { name: "oxc", description: "Linting" },
        { name: "next", description: "Next.js" },
      ],
      scripts: { dev: "next dev", build: "next build" },
    };
    expect(renderProjectReadme(input)).toBe(renderProjectReadme(input));
    expect(renderProjectReadme(input)).toBe(
      renderProjectReadme({ ...input, modules: input.modules.toReversed() }),
    );
    const vfs = Vfs.empty();
    vfs.write("package.json", JSON.stringify({ scripts: input.scripts }));
    const plan: Plan = { changes: [], hash: hashVfs(vfs), vfs };
    const first = withProjectReadme(plan, "/tmp/app", []);
    const second = withProjectReadme(plan, "/tmp/app", []);
    expect(second.hash).toBe(first.hash);
    expect(first.hash).not.toBe(plan.hash);
    expect(first.changes.map((change) => change.path)).toEqual(["README.md"]);
    expect(first.vfs.read("README.md")).toContain("`bun run build`");
  });
});

describe("create dry run", () => {
  test("names each contributing Module once per file", async () => {
    const parent = workspace();
    const result = await runAokit(
      ["create", join(parent, "app"), "--modules", "next,oxc,tailwind4", "--dry-run"],
      {},
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("create package.json (next, oxc, tailwind4)");
    expect(result.stdout).toContain("create README.md\n");
  });
});
