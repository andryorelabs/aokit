import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

const versionSchema = z.object({ version: z.string() });
const typesExportSchema = z.object({
  exports: z.record(z.string(), z.object({ types: z.string() })),
});
const binSchema = z.object({ bin: z.record(z.string(), z.string()) });
const releaseSchema = z.object({ release: z.string() });
const lockfileSchema = z.object({ registries: z.record(z.string(), releaseSchema) });
const registryIndexSchema = z.looseObject({
  release: z.string(),
  releases: z.record(z.string(), z.looseObject({ integrity: z.string(), path: z.string() })),
});
const catalogSchema = z.looseObject({ dependencies: z.record(z.string(), z.string()) });

const tarballVariable = process.env["AOKIT_DIST_TARBALLS"];
const describeWithTarballs = tarballVariable === undefined ? describe.skip : describe;
const tarballPaths = (tarballVariable ?? "").split(",").filter((path) => path !== "");

interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function spawnIn(command: readonly string[], cwd: string): Promise<SpawnResult> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function findTarball(prefix: string): string {
  const found = tarballPaths.find((path) => basename(path).startsWith(prefix));
  if (found === undefined) {
    throw new Error(`AOKIT_DIST_TARBALLS has no tarball starting with "${prefix}".`);
  }
  return found;
}

type ShimChild = Bun.Subprocess<"ignore", "pipe", "pipe">;

interface ShimRun {
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
  readonly stdout: string;
}

async function collectShimRun(child: ShimChild): Promise<ShimRun> {
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { exitCode: child.exitCode, signalCode: child.signalCode, stdout };
}

describeWithTarballs("the installed aokit and create-aokit tarballs", () => {
  let scratchRoot = "";
  let installDirectory = "";
  let aokitBin = "";
  let createAokitBin = "";
  let packageRoot = "";
  let aokitVersion = "";

  async function freshDirectory(name: string): Promise<string> {
    const directory = join(scratchRoot, name);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  beforeAll(async () => {
    scratchRoot = await mkdtemp(join(tmpdir(), "aokit-dist-package-"));
    installDirectory = await freshDirectory("install");
    const aokitTarball = findTarball("aokit-");
    const createTarball = findTarball("create-aokit-");
    await writeFile(
      join(installDirectory, "package.json"),
      JSON.stringify({
        name: "dist-consumer",
        private: true,
        dependencies: {
          aokit: `file:${aokitTarball}`,
          "create-aokit": `file:${createTarball}`,
        },
        overrides: { aokit: `file:${aokitTarball}` },
      }),
    );
    const installed = await spawnIn(["bun", "install"], installDirectory);
    expect(installed.exitCode, installed.stderr).toBe(0);
    aokitBin = join(installDirectory, "node_modules", ".bin", "aokit");
    createAokitBin = join(installDirectory, "node_modules", ".bin", "create-aokit");
    packageRoot = join(installDirectory, "node_modules", "aokit");
    const manifest = versionSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    aokitVersion = manifest.version;
  }, 120_000);

  afterAll(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  test("S1: aokit --version prints the package version and exits 0", async () => {
    const result = await spawnIn([aokitBin, "--version"], await freshDirectory("version"));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(aokitVersion);
    const bundle = await readFile(join(packageRoot, "dist", "cli.js"), "utf8");
    expect(bundle.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  test("S7: aokit/cli types resolve to an emitted declaration file", async () => {
    const manifest = typesExportSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    const typesPath = manifest.exports["./cli"]?.types ?? "";
    expect(typesPath.endsWith(".d.ts")).toBe(true);
    expect(typesPath.startsWith("./dist/")).toBe(true);
    expect(await Bun.file(join(packageRoot, typesPath)).exists()).toBe(true);
  });

  test("S7: the create-aokit bin runs under Node", async () => {
    const createRoot = join(installDirectory, "node_modules", "create-aokit");
    const manifest = binSchema.parse(
      JSON.parse(await readFile(join(createRoot, "package.json"), "utf8")),
    );
    const binPath = join(createRoot, manifest.bin["create-aokit"] ?? "");
    expect((await readFile(binPath, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
    const result = await spawnIn(["node", binPath, "--help"], await freshDirectory("node-help"));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("create");
  });

  async function startShimWithFakeBun(
    script: string,
    args: readonly string[],
    name: string,
  ): Promise<ShimChild> {
    const work = await freshDirectory(name);
    const fakeBin = join(work, "bin");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(fakeBin, "bun"), script, { mode: 0o755 });
    const createRoot = join(installDirectory, "node_modules", "create-aokit");
    const manifest = binSchema.parse(
      JSON.parse(await readFile(join(createRoot, "package.json"), "utf8")),
    );
    return Bun.spawn(["node", join(createRoot, manifest.bin["create-aokit"] ?? ""), ...args], {
      cwd: work,
      env: { ...process.env, PATH: `${fakeBin}:${process.env["PATH"] ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("the create-aokit bin disables the update notice, passes its arguments and relays the exit code", async () => {
    const script = '#!/bin/sh\necho "notifier=$AOKIT_NO_UPDATE_NOTIFIER"\necho "args=$*"\nexit 7\n';
    const result = await collectShimRun(await startShimWithFakeBun(script, ["my-app"], "shim-env"));
    expect(result.stdout).toContain("notifier=1");
    expect(result.stdout).toMatch(/args=.*cli\.js create my-app/);
    expect(result.exitCode).toBe(7);
  });

  test("the create-aokit bin dies by the same signal as its child", async () => {
    const child = await startShimWithFakeBun("#!/bin/sh\nkill -TERM $$\n", [], "shim-signal");
    const result = await collectShimRun(child);
    expect(result.signalCode ?? `exit ${String(result.exitCode)}`).toBe("SIGTERM");
  });

  test("the create-aokit bin passes SIGTERM on to its child and waits for it", async () => {
    const script =
      "#!/bin/sh\ntrap 'echo got-term; exit 0' TERM\necho ready\nwhile :; do sleep 0.1; done\n";
    const child = await startShimWithFakeBun(script, [], "shim-forward");
    const decoder = new TextDecoder();
    let seen = "";
    let signalled = false;
    for await (const chunk of child.stdout) {
      seen += decoder.decode(chunk, { stream: true });
      if (!signalled && seen.includes("ready")) {
        signalled = true;
        child.kill("SIGTERM");
      }
    }
    await child.exited;
    expect(signalled).toBe(true);
    expect(seen).toContain("got-term");
    expect(child.exitCode).toBe(0);
  });

  async function startAokitShim(
    pathValue: string,
    args: readonly string[],
    name: string,
  ): Promise<ShimChild> {
    const manifest = binSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    const nodePath = Bun.which("node");
    if (nodePath === null) {
      throw new Error("node is not on PATH.");
    }
    return Bun.spawn([nodePath, join(packageRoot, manifest.bin["aokit"] ?? ""), ...args], {
      cwd: await freshDirectory(name),
      env: { ...process.env, PATH: pathValue },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  async function fakeBunPath(script: string, name: string): Promise<string> {
    const fakeBin = join(await freshDirectory(name), "fake-bin");
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(fakeBin, "bun"), script, { mode: 0o755 });
    return fakeBin;
  }

  test("S4: the aokit bin is a Node shim that explains a missing Bun and exits 1", async () => {
    const manifest = binSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
    );
    const binPath = join(packageRoot, manifest.bin["aokit"] ?? "");
    expect((await readFile(binPath, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
    const child = await startAokitShim(await freshDirectory("no-bun"), ["--version"], "no-bun-cwd");
    const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(stderr).toContain("aokit needs Bun (>=1.4.4) on PATH: https://bun.sh");
    expect(child.exitCode).toBe(1);
  });

  test("S4: the aokit bin passes its arguments through and relays the exit code", async () => {
    const fakeBin = await fakeBunPath('#!/bin/sh\necho "args=$*"\nexit 7\n', "aokit-exit");
    const result = await collectShimRun(await startAokitShim(fakeBin, ["--json", "x"], "exit-cwd"));
    expect(result.stdout).toMatch(/args=.*dist\/cli\.js --json x/);
    expect(result.exitCode).toBe(7);
  });

  test("S4: the aokit bin dies by the same signal as its child", async () => {
    const fakeBin = await fakeBunPath("#!/bin/sh\nkill -TERM $$\n", "aokit-signal");
    const result = await collectShimRun(await startAokitShim(fakeBin, [], "signal-cwd"));
    expect(result.signalCode ?? `exit ${String(result.exitCode)}`).toBe("SIGTERM");
  });

  test("S4: the aokit bin passes SIGTERM on to its child and waits for it", async () => {
    const script =
      "#!/bin/sh\ntrap 'echo got-term; exit 0' TERM\necho ready\nwhile :; do sleep 0.1; done\n";
    const fakeBin = await fakeBunPath(script, "aokit-forward");
    const child = await startAokitShim(fakeBin, [], "forward-cwd");
    const decoder = new TextDecoder();
    let seen = "";
    let signalled = false;
    for await (const chunk of child.stdout) {
      seen += decoder.decode(chunk, { stream: true });
      if (!signalled && seen.includes("ready")) {
        signalled = true;
        child.kill("SIGTERM");
      }
    }
    await child.exited;
    expect(signalled).toBe(true);
    expect(seen).toContain("got-term");
    expect(child.exitCode).toBe(0);
  });

  test("S2: create resolves the Registry shipped inside the package", async () => {
    const workDirectory = await freshDirectory("create-bundled");
    const result = await spawnIn(
      [aokitBin, "create", "my-app", "--modules", "oxc", "--yes", "--json"],
      workDirectory,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const index = releaseSchema.parse(
      JSON.parse(await readFile(join(packageRoot, "registry", "index.json"), "utf8")),
    );
    const lockfile = lockfileSchema.parse(
      JSON.parse(await readFile(join(workDirectory, "my-app", "aokit.lock.json"), "utf8")),
    );
    expect(lockfile.registries["official"]?.release).toBe(index.release);
  }, 120_000);

  test("S4: the packaged create fails with format.version-mismatch on a differing oxc pin", async () => {
    const registryCopy = join(await freshDirectory("mismatch"), "registry");
    await cp(join(packageRoot, "registry"), registryCopy, { recursive: true });
    const indexPath = join(registryCopy, "index.json");
    const index = registryIndexSchema.parse(JSON.parse(await readFile(indexPath, "utf8")));
    const entry = index.releases[index.release];
    if (entry === undefined) {
      throw new Error("the packaged Registry index lacks its own latest Release.");
    }
    const catalogPath = join(registryCopy, entry.path);
    const catalog = catalogSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
    catalog.dependencies["oxfmt"] = "0.1.0";
    const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
    await writeFile(catalogPath, catalogText);
    const digest = new Bun.CryptoHasher("sha256").update(catalogText).digest("hex");
    entry.integrity = `sha256-${digest}`;
    await writeFile(indexPath, JSON.stringify(index, null, 2));
    const result = await spawnIn(
      [
        aokitBin,
        "create",
        "my-app",
        "--modules",
        "oxc",
        "--yes",
        "--json",
        "--no-install",
        "--registry",
        registryCopy,
      ],
      await freshDirectory("mismatch-work"),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("format.version-mismatch");
  }, 120_000);

  test("S5: create-aokit emits the same envelope and exit code as aokit create", async () => {
    const directDirectory = await freshDirectory("direct");
    const wrappedDirectory = await freshDirectory("wrapped");
    const direct = await spawnIn(
      [aokitBin, "create", "my-app", "--modules", "oxc", "--yes", "--json"],
      directDirectory,
    );
    const wrapped = await spawnIn(
      [createAokitBin, "my-app", "--modules", "oxc", "--yes", "--json"],
      wrappedDirectory,
    );
    expect(direct.exitCode, direct.stderr).toBe(0);
    expect(wrapped.exitCode).toBe(direct.exitCode);
    expect(wrapped.stdout.replaceAll(wrappedDirectory, "<cwd>")).toBe(
      direct.stdout.replaceAll(directDirectory, "<cwd>"),
    );
  }, 180_000);
});
