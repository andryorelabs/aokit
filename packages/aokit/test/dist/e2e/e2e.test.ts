import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { aokitCommand, spawnAokit } from "../../helpers/aokit-process.ts";
import { differingPaths, treeDigests } from "./tree-digest.ts";

const binaryPath = process.env["AOKIT_BIN"] ?? "";
const tarballPaths = (process.env["AOKIT_DIST_TARBALLS"] ?? "").split(",").filter(Boolean);
const describeWithBinary = binaryPath === "" ? describe.skip : describe;
const describeWithBoth = binaryPath === "" || tarballPaths.length === 0 ? describe.skip : describe;

interface CuratedProject {
  readonly name: string;
  readonly args: readonly string[];
}

const curatedProjects: readonly CuratedProject[] = [
  { name: "single-oxc", args: ["--modules", "oxc"] },
  { name: "single-web", args: ["--modules", "oxc,vite-react,tailwind4,knip"] },
  { name: "monorepo-oxc", args: ["--layout", "monorepo", "--modules", "oxc"] },
];

interface Envelope {
  readonly ok: boolean;
  readonly data: unknown;
  readonly error: { readonly code: string } | null;
}

function parseEnvelope(stdout: string): Envelope {
  return JSON.parse(stdout);
}

async function git(directory: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await child.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${await new Response(child.stderr).text()}`);
  }
}

describeWithBinary("S12: lifecycle through the binary", () => {
  setDefaultTimeout(180_000);
  let scratch = "";

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "aokit-e2e-"));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  test("create, add, remove and update emit valid envelopes and exit 0", async () => {
    expect(aokitCommand()).toEqual([binaryPath]);
    const created = await spawnAokit(
      ["create", "app", "--modules", "oxc", "--yes", "--no-install", "--json"],
      { cwd: scratch },
    );
    expect(created.exitCode, created.stdout + created.stderr).toBe(0);
    expect(parseEnvelope(created.stdout).ok).toBe(true);
    const project = join(scratch, "app");
    await git(project, "init", "-q");
    await git(project, "add", "-A");
    await git(project, "commit", "-q", "-m", "initial");

    const steps: readonly (readonly string[])[] = [["add", "knip"], ["remove", "knip"], ["update"]];
    for (const step of steps) {
      const command = step.join(" ");
      // oxlint-disable-next-line eslint/no-await-in-loop -- steps depend on each other
      const result = await spawnAokit([...step, "--yes", "--no-install", "--json"], {
        cwd: project,
      });
      expect(result.exitCode, `${command}: ${result.stdout}${result.stderr}`).toBe(0);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.ok, command).toBe(true);
      expect(envelope.error).toBeNull();
      // oxlint-disable-next-line eslint/no-await-in-loop -- steps depend on each other
      await git(project, "add", "-A");
      // oxlint-disable-next-line eslint/no-await-in-loop -- steps depend on each other
      await git(project, "commit", "-q", "--allow-empty", "-m", command);
    }
  });

  test("a failing command keeps the envelope shape and a non-zero exit code", async () => {
    const result = await spawnAokit(["add", "knip", "--yes", "--json"], { cwd: scratch });
    expect(result.exitCode).not.toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBeTypeOf("string");
  });
});

describeWithBoth("S12: npm package and binary digests", () => {
  setDefaultTimeout(300_000);
  let scratch = "";
  let packageBin = "";

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "aokit-e2e-digest-"));
    const installDirectory = join(scratch, "install");
    await mkdir(installDirectory, { recursive: true });
    const aokitTarball = tarballPaths.find((path) => basename(path).startsWith("aokit-"));
    if (aokitTarball === undefined) {
      throw new Error("AOKIT_DIST_TARBALLS has no tarball starting with aokit-.");
    }
    await writeFile(
      join(installDirectory, "package.json"),
      JSON.stringify({
        name: "digest-consumer",
        private: true,
        dependencies: { aokit: `file:${aokitTarball}` },
      }),
    );
    const install = Bun.spawn(["bun", "install"], {
      cwd: installDirectory,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited, await new Response(install.stderr).text()).toBe(0);
    packageBin = join(installDirectory, "node_modules", ".bin", "aokit");
  }, 120_000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  async function createWith(executable: string, label: string, project: CuratedProject) {
    const cwd = join(scratch, label);
    await mkdir(cwd, { recursive: true });
    const child = Bun.spawn(
      [executable, "create", "app", ...project.args, "--yes", "--no-install", "--json"],
      { cwd, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stdout + stderr).toBe(0);
    return treeDigests(join(cwd, "app"));
  }

  for (const project of curatedProjects) {
    test(`create ${project.name} is byte-identical between package and binary`, async () => {
      const fromPackage = await createWith(packageBin, `pkg-${project.name}`, project);
      const fromBinary = await createWith(binaryPath, `bin-${project.name}`, project);
      const differing = differingPaths(fromPackage, fromBinary);
      expect(differing, `differing paths:\n${differing.join("\n")}`).toEqual([]);
      expect(fromPackage.size).toBeGreaterThan(0);
    });
  }
});
