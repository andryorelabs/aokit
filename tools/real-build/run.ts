import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { type Combination, type Step, combinationLabel, planSteps } from "./plan.ts";

/** Outcome of one command. */
interface ExecResult {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs `command` in `cwd` and resolves with its exit code and combined output. */
export type Exec = (command: readonly string[], cwd: string) => Promise<ExecResult>;

/** Where the real build runs and how it reaches the outside world. */
export interface RunContext {
  readonly exec: Exec;
  /** The aokit workspace root, holding `packages/aokit/src/cli/main.ts`. */
  readonly workspaceRoot: string;
  /** Directory the Project is created in; it must not exist or be empty. */
  readonly projectDirectory: string;
  /** Registry passed to `aokit create --registry`; the bundled one when absent. */
  readonly registry?: string;
  readonly log: (line: string) => void;
}

/** Result of one combination: the failed step, if any, with its output. */
export interface CombinationResult {
  readonly label: string;
  readonly ok: boolean;
  readonly failedStep?: string;
  readonly output?: string;
}

async function listProjectFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry) => {
        const path = relative === "" ? entry.name : posix.join(relative, entry.name);
        if (entry.isDirectory()) return listProjectFiles(root, path);
        return entry.isFile() ? [path] : [];
      }),
  );
  return nested.flat();
}

async function readPackageManifests(
  root: string,
  files: readonly string[],
): Promise<Record<string, unknown>> {
  const manifests: Record<string, unknown> = {};
  const paths = files.filter((path) => posix.basename(path) === "package.json");
  const contents = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
  for (const [index, path] of paths.entries()) {
    manifests[path] = JSON.parse(contents[index] ?? "null");
  }
  return manifests;
}

/**
 * The `tsc` a typecheck step uses: the Project's own (installed in the step's package or at the
 * Project root), else the TypeScript of the aokit workspace.
 */
function resolveTsc(context: RunContext, cwd: string): string {
  const candidates = [
    join(context.projectDirectory, cwd, "node_modules", ".bin", "tsc"),
    join(context.projectDirectory, "node_modules", ".bin", "tsc"),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    join(context.workspaceRoot, "node_modules", "typescript7", "bin", "tsc")
  );
}

/** A syntactically valid connection string; generating a client never connects to it. */
const placeholderDatabaseUrl = "postgresql://aokit:aokit@localhost:5432/aokit";

function commandFor(context: RunContext, step: Step): string[] {
  if (step.kind === "typecheck") return [resolveTsc(context, step.cwd), ...step.args];
  if (step.kind === "generate") {
    return ["env", `DATABASE_URL=${placeholderDatabaseUrl}`, "bun", ...step.args];
  }
  return ["bun", ...step.args];
}

function createCommand(context: RunContext, combination: Combination): string[] {
  return [
    "bun",
    join(context.workspaceRoot, "packages", "aokit", "src", "cli", "main.ts"),
    "create",
    context.projectDirectory,
    "--layout",
    combination.layout,
    "--modules",
    combination.modules.join(","),
    "--yes",
    "--json",
    "--no-install",
    ...(context.registry === undefined ? [] : ["--registry", context.registry]),
  ];
}

function createSucceeded(result: ExecResult): boolean {
  if (result.exitCode !== 0) return false;
  try {
    const envelope: unknown = JSON.parse(result.output);
    return (
      typeof envelope === "object" && envelope !== null && "ok" in envelope && envelope.ok === true
    );
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

/**
 * Creates one combination with `aokit create --yes --json`, then runs its planned steps (install,
 * client generation, builds, typechecks) in order and stops at the first failing one.
 */
export async function runCombination(
  combination: Combination,
  context: RunContext,
): Promise<CombinationResult> {
  const label = combinationLabel(combination);
  context.log(`create ${label} in ${context.projectDirectory}`);
  const created = await context.exec(createCommand(context, combination), context.workspaceRoot);
  if (!createSucceeded(created)) {
    return { label, ok: false, failedStep: "create", output: created.output };
  }
  const files = await listProjectFiles(context.projectDirectory);
  const steps = planSteps(files, await readPackageManifests(context.projectDirectory, files));
  for (const step of steps) {
    context.log(`${label}: ${step.name}`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- steps depend on the previous one
    const result = await context.exec(
      commandFor(context, step),
      join(context.projectDirectory, step.cwd),
    );
    if (result.exitCode !== 0) {
      return { label, ok: false, failedStep: step.name, output: result.output };
    }
  }
  return { label, ok: true };
}
