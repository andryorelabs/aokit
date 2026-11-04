import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aokitCommand, spawnAokit } from "../../helpers/aokit-process.ts";

const describeWithBinary = (process.env["AOKIT_BIN"] ?? "") === "" ? describe.skip : describe;

const committedRegistry = join(import.meta.dir, "../../../../../registry");

interface RegistryIndex {
  readonly modules: Record<
    string,
    { readonly versions: Record<string, { readonly integrity: string }> }
  >;
}

async function runGit(directory: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await child.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${await new Response(child.stderr).text()}`);
  }
}

async function visibleEntries(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

describeWithBinary("the standalone binary", () => {
  setDefaultTimeout(120_000);

  let scratch = "";

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "aokit-binary-"));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  async function freshDirectory(name: string): Promise<string> {
    const directory = join(scratch, name);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  test("ignores the working directory's bunfig.toml and .env", async () => {
    const workDirectory = await freshDirectory("autoload");
    const homeDirectory = await freshDirectory("autoload-home");
    const leakDirectory = join(workDirectory, "leak");
    await writeFile(join(workDirectory, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
    await writeFile(
      join(workDirectory, "preload.ts"),
      'await Bun.write("preload-marker.txt", "ran");\n',
    );
    await writeFile(join(workDirectory, ".env"), `XDG_CACHE_HOME=${leakDirectory}\n`);
    const { XDG_CACHE_HOME: _inherited, ...inheritedEnv } = process.env;
    const child = Bun.spawn(
      [
        ...aokitCommand(),
        "create",
        "my-app",
        "--modules",
        "oxc",
        "--yes",
        "--no-install",
        "--json",
      ],
      {
        cwd: workDirectory,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...inheritedEnv, HOME: homeDirectory },
      },
    );
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(workDirectory, "preload-marker.txt")).exists()).toBe(false);
    expect(await readdir(workDirectory)).not.toContain("leak");
    expect(await Bun.file(join(workDirectory, "my-app", "aokit.lock.json")).exists()).toBe(true);
  });

  test("starts when the cache directory is unwritable", async () => {
    const workDirectory = await freshDirectory("unwritable");
    const blocker = join(workDirectory, "not-a-directory");
    await writeFile(blocker, "file");
    const result = await spawnAokit(["--version", "--json"], {
      cwd: workDirectory,
      env: { XDG_CACHE_HOME: blocker },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  });

  test("creates a Project that formats and parses with the embedded native bindings", async () => {
    const workDirectory = await freshDirectory("native");
    const cacheDirectory = await freshDirectory("native-cache");
    const result = await spawnAokit(
      ["create", "my-app", "--modules", "oxc,vite-react", "--yes", "--no-install", "--json"],
      { cwd: workDirectory, env: { XDG_CACHE_HOME: cacheDirectory } },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  });

  test("extracts the embedded Registry once and reuses it", async () => {
    const workDirectory = await freshDirectory("extract");
    const cacheDirectory = await freshDirectory("extract-cache");
    const env = { XDG_CACHE_HOME: cacheDirectory };
    for (const name of ["first", "second"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the second run must see the first run's cache
      const result = await spawnAokit(
        ["create", name, "--modules", "oxc", "--yes", "--no-install", "--json"],
        {
          cwd: workDirectory,
          env,
        },
      );
      expect(result.exitCode).toBe(0);
    }
    const extracted = await visibleEntries(join(cacheDirectory, "aokit", "bundled-registry"));
    expect(extracted).toHaveLength(1);
    expect(
      await Bun.file(
        join(cacheDirectory, "aokit", "bundled-registry", extracted[0] ?? "", "index.json"),
      ).exists(),
    ).toBe(true);
  });

  test("two parallel first runs leave one intact extracted directory", async () => {
    const workDirectory = await freshDirectory("race");
    const cacheDirectory = await freshDirectory("race-cache");
    const env = { XDG_CACHE_HOME: cacheDirectory };
    const results = await Promise.all(
      ["left", "right"].map((name) =>
        spawnAokit(["create", name, "--modules", "oxc", "--yes", "--no-install", "--json"], {
          cwd: workDirectory,
          env,
        }),
      ),
    );
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    const registryRoot = join(cacheDirectory, "aokit", "bundled-registry");
    expect(await visibleEntries(registryRoot)).toHaveLength(1);
    expect(await readdir(registryRoot)).toHaveLength(1);
  });

  test("runs a Migration from the extracted Registry during update", async () => {
    const workDirectory = await freshDirectory("update");
    const cacheDirectory = await freshDirectory("update-cache");
    const env = { XDG_CACHE_HOME: cacheDirectory };
    const created = await spawnAokit(
      ["create", "latest", "--modules", "vite-react", "--yes", "--no-install", "--json"],
      { cwd: workDirectory, env },
    );
    expect(created.exitCode).toBe(0);
    const index: RegistryIndex = JSON.parse(
      await readFile(join(committedRegistry, "index.json"), "utf8"),
    );
    const olderIntegrity = index.modules["vite-react"]?.versions["1.0.0"]?.integrity;
    if (olderIntegrity === undefined) throw new Error("the Registry has no vite-react 1.0.0");
    const lockfile = JSON.parse(
      await readFile(join(workDirectory, "latest", "aokit.lock.json"), "utf8"),
    );
    lockfile.registries.official.release = "2026.11.0";
    lockfile.modules["vite-react"].version = "1.0.0";
    lockfile.modules["vite-react"].integrity = olderIntegrity;
    await writeFile(join(workDirectory, "older.lock.json"), JSON.stringify(lockfile));
    const older = await spawnAokit(
      ["create", "app", "--from", "older.lock.json", "--yes", "--no-install", "--json"],
      { cwd: workDirectory, env },
    );
    expect(older.exitCode).toBe(0);
    const projectDirectory = join(workDirectory, "app");
    expect(await Bun.file(join(projectDirectory, "src", "routes.tsx")).exists()).toBe(true);
    await runGit(projectDirectory, "init", "-q");
    await runGit(projectDirectory, "add", "-A");
    await runGit(projectDirectory, "commit", "-q", "-m", "init");
    const updated = await spawnAokit(["update", "--yes", "--no-install", "--json"], {
      cwd: projectDirectory,
      env,
    });
    expect(updated.exitCode).toBe(0);
    expect(JSON.parse(updated.stdout)).toMatchObject({ ok: true });
    expect(await Bun.file(join(projectDirectory, "src", "router.tsx")).exists()).toBe(true);
    expect(await Bun.file(join(projectDirectory, "src", "routes.tsx")).exists()).toBe(false);
  });
});
