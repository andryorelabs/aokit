import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  answersOnce,
  answersOverHttp,
  exec,
  listFiles,
  main,
  parseLayout,
  smoke,
  type ExecResult,
  type Runner,
} from "./main.ts";

interface Call {
  readonly command: readonly string[];
  readonly cwd: string;
}

interface Script {
  readonly dockerfile?: boolean;
  readonly createOutput?: string;
  readonly failOn?: string;
  readonly port?: string;
}

function fakeRunner(script: Script = {}): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = async (command, cwd): Promise<ExecResult> => {
    calls.push({ command, cwd });
    const [first, second] = command;
    if (first === "bun" && command.includes("create")) {
      const project = command[command.indexOf("create") + 1] ?? "";
      await mkdir(join(project, "node_modules"), { recursive: true });
      await writeFile(join(project, "node_modules", "Dockerfile"), "");
      if (script.dockerfile !== false) await writeFile(join(project, "Dockerfile"), "");
      return { exitCode: 0, output: script.createOutput ?? '{"ok":true}' };
    }
    if (second !== undefined && second === script.failOn) {
      return { exitCode: 1, output: "boom\n".repeat(60) };
    }
    if (second === "port") return { exitCode: 0, output: script.port ?? "" };
    if (second === "logs") return { exitCode: 0, output: "container logs" };
    return { exitCode: 0, output: "" };
  };
  return { runner, calls };
}

const servers: { stop(force: boolean): void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function serve(status: number): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("", { status }),
  });
  servers.push(server);
  return String(server.port);
}

async function silenced<T>(run: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const stderr: string[] = [];
  const errSpy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const outSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    return { result: await run(), stderr: stderr.join("") };
  } finally {
    errSpy.mockRestore();
    outSpy.mockRestore();
  }
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  return silenced(run).then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("smoke", () => {
  test("scaffolds, builds, runs, probes and always removes the container", async () => {
    const port = serve(200);
    const { runner, calls } = fakeRunner({ port: `127.0.0.1:${port}\n` });
    await silenced(() => smoke({ layout: "single", attempts: 2, delayMs: 1 }, runner));
    const steps = calls.map((call) => call.command.slice(0, 2).join(" "));
    for (const step of ["bun install", "docker build", "docker run", "docker port"]) {
      expect(steps).toContain(step);
    }
    expect(steps.at(-1)).toBe("docker rm");
    expect(calls.find((call) => call.command[1] === "build")?.command).toContain("Dockerfile");
  });

  test("fails with the command tail when a step exits non-zero", async () => {
    const { runner } = fakeRunner({ failOn: "build" });
    const message = await rejection(() => smoke({ layout: "single" }, runner));
    expect(message).toMatch(/build single failed \(1\)/);
  });

  test("fails when create does not report ok", async () => {
    const { runner } = fakeRunner({ createOutput: '{"ok":false}' });
    const message = await rejection(() => smoke({ layout: "monorepo" }, runner));
    expect(message).toMatch(/did not report ok/);
  });

  test("fails when the Project has no Dockerfile", async () => {
    const { runner } = fakeRunner({ dockerfile: false });
    const message = await rejection(() => smoke({ layout: "single" }, runner));
    expect(message).toMatch(/no Dockerfile/);
  });

  test("includes container logs and removes the container when HTTP never answers", async () => {
    const { runner, calls } = fakeRunner({ port: "0.0.0.0:1\n" });
    const message = await rejection(() =>
      smoke({ layout: "single", attempts: 1, delayMs: 1 }, runner),
    );
    expect(message).toMatch(/did not answer over HTTP \(single\)\ncontainer logs/);
    expect(calls.at(-1)?.command.slice(0, 2)).toEqual(["docker", "rm"]);
  });
});

describe("HTTP probes", () => {
  test("answersOnce is true for a healthy server and false for a 500", async () => {
    expect(await answersOnce(serve(200))).toBe(true);
    expect(await answersOnce(serve(500))).toBe(false);
  });

  test("answersOnce is false when nothing listens", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = String(server.port);
    await server.stop(true);
    expect(await answersOnce(port)).toBe(false);
  });

  test("answersOverHttp resolves true when healthy and false when attempts run out", async () => {
    expect(await answersOverHttp(serve(200), 3, 1)).toBe(true);
    expect(await answersOverHttp(serve(500), 2, 1)).toBe(false);
    expect(await answersOverHttp(serve(200), 0, 1)).toBe(false);
  });
});

describe("listFiles", () => {
  test("lists nested files and skips node_modules and the VCS directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "docker-smoke-list-"));
    roots.push(root);
    await mkdir(join(root, "apps", "server"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "a.ts"), "");
    await writeFile(join(root, "apps", "server", "Dockerfile"), "");
    await writeFile(join(root, "node_modules", "x.js"), "");
    await writeFile(join(root, ".git", "HEAD"), "");
    expect((await listFiles(root)).toSorted()).toEqual(["a.ts", "apps/server/Dockerfile"]);
  });
});

describe("CLI", () => {
  test("parseLayout accepts the two layouts and rejects anything else", () => {
    expect(parseLayout(["--layout", "single"])).toBe("single");
    expect(parseLayout(["--layout", "monorepo"])).toBe("monorepo");
    expect(parseLayout(["--layout", "other"])).toBeUndefined();
    expect(parseLayout([])).toBeUndefined();
  });

  test("main exits 2 with a usage line when the layout is missing", async () => {
    const { result, stderr } = await silenced(() => main([], fakeRunner().runner));
    expect(result).toBe(2);
    expect(stderr).toContain("usage: bun tools/docker-smoke/main.ts");
  });

  test("main exits 1 on failure and 0 on success", async () => {
    const port = serve(200);
    const failed = await silenced(() =>
      main(["--layout", "single"], fakeRunner({ dockerfile: false }).runner),
    );
    expect(failed.result).toBe(1);
    expect(failed.stderr).toContain("FAIL single: no Dockerfile");
    const passed = await silenced(() =>
      main(["--layout", "single"], fakeRunner({ port: `127.0.0.1:${port}` }).runner),
    );
    expect(passed.result).toBe(0);
  });
});

describe("exec", () => {
  test("reports the exit code and combines stdout with stderr", async () => {
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)';
    expect(await exec(["bun", "-e", script], tmpdir())).toEqual({ exitCode: 3, output: "outerr" });
  });

  test("returns stdout alone when stderr is empty", async () => {
    expect(await exec(["bun", "-e", 'process.stdout.write("only")'], tmpdir())).toEqual({
      exitCode: 0,
      output: "only",
    });
  });
});
