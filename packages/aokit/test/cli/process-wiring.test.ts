import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunOptions, run } from "../../src/cli/run.ts";
import {
  refreshArgument,
  runDetachedRefresh,
  spawnDetachedRefresh,
} from "../../src/cli/update-notice/spawn.ts";
import { runShutdownHooks } from "../../src/cli/shutdown.ts";
import { runInstall } from "../../src/project/install.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aokit-wiring-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createRunOptions", () => {
  test("wires the real process streams and enables the update notice by default", () => {
    const stdoutWrite = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const options = createRunOptions(["list"]);
      options.io.stdout("out");
      options.io.stderr("err");
      expect(stdoutWrite).toHaveBeenCalledWith("out");
      expect(stderrWrite).toHaveBeenCalledWith("err");
      expect(options.updateNotice).toBe(true);
      expect(options.argv).toEqual(["list"]);
      expect(createRunOptions([], { updateNotice: false }).updateNotice).toBe(false);
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });
});

describe("run", () => {
  test("runs the CLI in-process and returns its exit code", async () => {
    const stdoutWrite = spyOn(process.stdout, "write").mockImplementation(() => true);
    const sigint = process.listeners("SIGINT");
    const sigterm = process.listeners("SIGTERM");
    try {
      const exitCode = await run(["--version"], { updateNotice: false });
      expect(exitCode).toBe(0);
      expect(stdoutWrite).toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      for (const listener of process.listeners("SIGINT")) {
        if (!sigint.includes(listener)) process.off("SIGINT", listener);
      }
      for (const listener of process.listeners("SIGTERM")) {
        if (!sigterm.includes(listener)) process.off("SIGTERM", listener);
      }
    }
  });
});

describe("update notice refresh process", () => {
  test("spawnDetachedRefresh starts a detached process with the hidden refresh argument", () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("recorded only");
    });
    try {
      spawnDetachedRefresh();
      const [command, options] = spawn.mock.calls[0] ?? [];
      expect(Array.isArray(command) ? command.at(-1) : undefined).toBe(refreshArgument);
      expect(options).toMatchObject({ stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    } finally {
      spawn.mockRestore();
    }
  });

  test("spawnDetachedRefresh never throws when the process cannot start", () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("cannot spawn");
    });
    try {
      expect(() => spawnDetachedRefresh()).not.toThrow();
    } finally {
      spawn.mockRestore();
    }
  });

  test("runDetachedRefresh caches the latest version from the registry", async () => {
    const previousCache = process.env["XDG_CACHE_HOME"];
    process.env["XDG_CACHE_HOME"] = root;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        () => Promise.resolve(new Response(JSON.stringify({ version: "9.8.7" }), { status: 200 })),
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      await runDetachedRefresh();
      expect(readFileSync(join(root, "aokit", "update-check.json"), "utf8")).toContain("9.8.7");
    } finally {
      fetchSpy.mockRestore();
      if (previousCache === undefined) delete process.env["XDG_CACHE_HOME"];
      else process.env["XDG_CACHE_HOME"] = previousCache;
    }
  });
});

describe("runInstall", () => {
  test("succeeds for a Project without dependencies", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "empty", version: "1.0.0" }));
    await runInstall(root, process.env);
  }, 60_000);

  test("a failing install is an IO_ERROR that says how to finish", async () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "broken", dependencies: { missing: "file:./nowhere" } }),
    );
    const failure = await runInstall(root, process.env).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "IO_ERROR" });
    expect(String(failure)).toContain("bun install");
  }, 60_000);

  test("an install that cannot start is an IO_ERROR", async () => {
    const failure = await runInstall(join(root, "missing"), process.env).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "IO_ERROR" });
  });

  test("a shutdown signal kills the running install", async () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "slow", scripts: { preinstall: "sleep 30" } }),
    );
    const installing = runInstall(root, process.env).catch((error: unknown) => error);
    await new Promise((resolveTurn) => setTimeout(resolveTurn, 500));
    await runShutdownHooks();
    expect(await installing).toMatchObject({ code: "IO_ERROR" });
  }, 60_000);
});
