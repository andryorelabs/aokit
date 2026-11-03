import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const workspaceRoot = join(import.meta.dir, "..", "..");
const containerPort = 3000;
const readinessAttempts = 30;

/** Outcome of one command. */
interface ExecResult {
  readonly exitCode: number;
  readonly output: string;
}

/** Layout names accepted by `aokit create --layout`. */
export type LayoutName = "single" | "monorepo";

/** Arguments for `aokit create` that scaffold the `oxc,hono,docker` selection. */
export function createArguments(layout: LayoutName, projectDirectory: string): string[] {
  return [
    "bun",
    join(workspaceRoot, "packages", "aokit", "src", "cli", "main.ts"),
    "create",
    projectDirectory,
    "--layout",
    layout,
    "--modules",
    "oxc,hono,docker",
    "--yes",
    "--json",
    "--no-install",
  ];
}

/** Docker image tag for a Layout. */
export function imageTag(layout: LayoutName): string {
  return `aokit-smoke-${layout}`;
}

/** Container name for a Layout. */
export function containerName(layout: LayoutName): string {
  return `aokit-smoke-${layout}`;
}

/** Picks the Dockerfile closest to the Project root, or `undefined` when there is none. */
export function pickDockerfile(files: readonly string[]): string | undefined {
  const candidates = files.filter((path) => path === "Dockerfile" || path.endsWith("/Dockerfile"));
  return candidates.toSorted(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  )[0];
}

/** Whether the `aokit create --json` stdout reports success. */
export function createSucceeded(output: string): boolean {
  try {
    const envelope: unknown = JSON.parse(output);
    return (
      typeof envelope === "object" && envelope !== null && "ok" in envelope && envelope.ok === true
    );
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

async function exec(command: readonly string[], cwd: string): Promise<ExecResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stderr === "" ? stdout : `${stdout}${stderr}` };
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map((entry) => {
        const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
        return entry.isDirectory() ? listFiles(root, path) : Promise.resolve([path]);
      }),
  );
  return nested.flat();
}

async function mustRun(command: readonly string[], cwd: string, step: string): Promise<string> {
  process.stdout.write(`> ${step}\n`);
  const result = await exec(command, cwd);
  if (result.exitCode !== 0) {
    const tail = result.output.trim().split("\n").slice(-40).join("\n");
    throw new Error(`${step} failed (${result.exitCode})\n${tail}`);
  }
  return result.output;
}

async function answersOnce(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    return response.ok;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

async function answersOverHttp(port: string, attemptsLeft = readinessAttempts): Promise<boolean> {
  if (attemptsLeft === 0) return false;
  if (await answersOnce(port)) return true;
  await Bun.sleep(1000);
  return answersOverHttp(port, attemptsLeft - 1);
}

async function smoke(layout: LayoutName): Promise<void> {
  const project = join(await mkdtemp(join(tmpdir(), "aokit-docker-smoke-")), "project");
  const created = await mustRun(
    createArguments(layout, project),
    workspaceRoot,
    `create ${layout}`,
  );
  if (!createSucceeded(created)) throw new Error(`create ${layout} did not report ok:\n${created}`);
  const dockerfile = pickDockerfile(await listFiles(project));
  if (dockerfile === undefined) throw new Error(`no Dockerfile in the ${layout} Project`);
  await mustRun(["bun", "install"], project, `install ${layout}`);
  const tag = imageTag(layout);
  const name = containerName(layout);
  await mustRun(["docker", "build", "-f", dockerfile, "-t", tag, "."], project, `build ${layout}`);
  try {
    await mustRun(
      ["docker", "run", "-d", "--name", name, "-p", `127.0.0.1::${containerPort}`, tag],
      project,
      `run ${layout}`,
    );
    const mapping = await mustRun(["docker", "port", name, `${containerPort}`], project, "port");
    const port = mapping.trim().split("\n")[0]?.split(":").pop() ?? "";
    if (!(await answersOverHttp(port))) {
      const logs = await exec(["docker", "logs", name], project);
      throw new Error(`container did not answer over HTTP (${layout})\n${logs.output}`);
    }
    process.stdout.write(`PASS ${layout}\n`);
  } finally {
    await exec(["docker", "rm", "-f", name], project);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { layout: { type: "string" } } });
  const layout = values.layout;
  if (layout !== "single" && layout !== "monorepo") {
    process.stderr.write("usage: bun tools/docker-smoke/main.ts --layout single|monorepo\n");
    process.exit(2);
  }
  try {
    await smoke(layout);
  } catch (error) {
    process.stderr.write(
      `FAIL ${layout}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
