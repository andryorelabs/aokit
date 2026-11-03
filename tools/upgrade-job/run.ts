import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  type Edit,
  type LockedFile,
  type RegistryIndex,
  applyEdit,
  indexAtRelease,
  planEdits,
  releasePairs,
} from "./plan.ts";

/** Outcome of one command. */
interface ExecResult {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs `command` in `cwd` and resolves with its exit code and output. */
export type Exec = (command: readonly string[], cwd: string) => Promise<ExecResult>;

/** The two supported Layouts. */
type Layout = "single" | "monorepo";

/** One Release pair, selection and Layout the job upgrades. */
export interface UpgradeCase {
  readonly from: string;
  readonly to: string;
  readonly layout: Layout;
  readonly modules: readonly string[];
}

/** Where the job runs. */
export interface JobContext {
  readonly exec: Exec;
  /** The aokit workspace root, holding `packages/aokit/src/cli/main.ts` and `registry/`. */
  readonly workspaceRoot: string;
  /** Empty directory the Registry copy and the Projects are created in. */
  readonly scratch: string;
  readonly log: (line: string) => void;
}

/** Result of one case: the failures found, empty when the update held. */
export interface CaseResult {
  readonly label: string;
  readonly ok: boolean;
  readonly failures: readonly string[];
}

function caseLabel(entry: UpgradeCase): string {
  return `${entry.from} -> ${entry.to} ${entry.layout} ${entry.modules.join(",")}`;
}

async function readIndex(registry: string): Promise<RegistryIndex> {
  return JSON.parse(await readFile(join(registry, "index.json"), "utf8"));
}

async function writeIndex(registry: string, index: RegistryIndex): Promise<void> {
  await writeFile(join(registry, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/** Every consecutive Release pair the Registry at `registry` lists. */
export async function pairsOf(registry: string): Promise<[string, string][]> {
  const releases = Object.keys((await readIndex(registry)).releases);
  if (releases.length > 2) {
    throw new Error(
      `The Registry lists ${releases.length} Releases, but the index does not record which Module versions each Release fixes, so the Upgrade job can only rebuild a two-Release index. Record per-Release Module versions before adding a third Release.`,
    );
  }
  return releasePairs(releases);
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry) => {
        const path = relative === "" ? entry.name : posix.join(relative, entry.name);
        if (entry.isDirectory()) return listFiles(root, path);
        return entry.isFile() ? [path] : [];
      }),
  );
  return nested.flat();
}

function cliCommand(context: JobContext, args: readonly string[]): string[] {
  return ["bun", join(context.workspaceRoot, "packages/aokit/src/cli/main.ts"), ...args];
}

function git(context: JobContext, directory: string, args: readonly string[]): Promise<ExecResult> {
  const identity = ["-c", "user.name=upgrade-job", "-c", "user.email=job@example.com"];
  return context.exec(["git", ...identity, "-c", "commit.gpgsign=false", ...args], directory);
}

async function writeEdits(directory: string, edits: readonly Edit[]): Promise<void> {
  for (const edit of edits) {
    const path = join(directory, edit.path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- edits to one tree stay ordered
    const content = existsSync(path) ? await readFile(path, "utf8") : "";
    // oxlint-disable-next-line eslint/no-await-in-loop -- edits to one tree stay ordered
    await mkdir(dirname(path), { recursive: true });
    // oxlint-disable-next-line eslint/no-await-in-loop -- edits to one tree stay ordered
    await writeFile(path, applyEdit(edit, content), "utf8");
  }
}

function editFailures(edit: Edit, contents: ReadonlyMap<string, string>): string[] {
  const own = contents.get(edit.path);
  const holder =
    own?.includes(edit.marker) === true
      ? own
      : [...contents.values()].find((text) => text.includes(edit.marker));
  if (holder === undefined) return [`edit lost: ${edit.kind} ${edit.path} (${edit.marker})`];
  if (edit.kind !== "user-import") return [];
  const routerExists = [...contents.keys()].some((path) => path.endsWith("src/router.tsx"));
  const expected = routerExists ? "./router" : "./routes";
  return holder.includes(`from "${expected}"`)
    ? []
    : [`user file ${edit.path} does not import ${expected}`];
}

async function preservedFailures(directory: string, edits: readonly Edit[]): Promise<string[]> {
  const files = await listFiles(directory);
  const contents = new Map(
    await Promise.all(
      files.map(async (path) => [path, await readFile(join(directory, path), "utf8")] as const),
    ),
  );
  return edits.flatMap((edit) => editFailures(edit, contents));
}

function conflictCount(output: string): number | undefined {
  try {
    const envelope: unknown = JSON.parse(output);
    if (typeof envelope !== "object" || envelope === null || !("data" in envelope)) {
      return undefined;
    }
    const data = envelope.data;
    if (typeof data !== "object" || data === null || !("conflicts" in data)) return undefined;
    return Array.isArray(data.conflicts) ? data.conflicts.length : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function lockedFiles(directory: string): Promise<Record<string, LockedFile>> {
  const lock = JSON.parse(await readFile(join(directory, "aokit.lock.json"), "utf8"));
  return lock.files;
}

async function lockedReleases(directory: string): Promise<string[]> {
  const lock = JSON.parse(await readFile(join(directory, "aokit.lock.json"), "utf8"));
  return Object.values<{ release: string }>(lock.registries).map((registry) => registry.release);
}

async function createAndEdit(
  entry: UpgradeCase,
  context: JobContext,
  registry: string,
  directory: string,
): Promise<{ edits: Edit[] } | { failure: string }> {
  const created = await context.exec(
    cliCommand(context, [
      "create",
      directory,
      "--layout",
      entry.layout,
      "--modules",
      entry.modules.join(","),
      "--registry",
      registry,
      "--yes",
      "--json",
      "--no-install",
    ]),
    context.workspaceRoot,
  );
  if (created.exitCode !== 0) {
    return { failure: `create exited ${created.exitCode}: ${created.output.slice(-400)}` };
  }
  const edits = planEdits(await lockedFiles(directory), entry.modules);
  await writeEdits(directory, edits);
  await git(context, directory, ["init", "-q"]);
  await git(context, directory, ["add", "-A"]);
  await git(context, directory, ["commit", "-q", "-m", `created at ${entry.from}`]);
  return { edits };
}

/**
 * Runs one case against the Registry copy at `registry`: creates the Project at `from`, edits it,
 * commits, restores the full index and runs `update --yes --no-install`, then asserts exit 0, zero
 * Conflicts and every edit preserved.
 */
async function runCase(
  entry: UpgradeCase,
  context: JobContext,
  registry: string,
  directory: string,
): Promise<CaseResult> {
  const label = caseLabel(entry);
  const fullIndex = await readIndex(registry);
  await writeIndex(registry, indexAtRelease(fullIndex, entry.from));
  try {
    const prepared = await createAndEdit(entry, context, registry, directory);
    if ("failure" in prepared) return { label, ok: false, failures: [prepared.failure] };
    await writeIndex(registry, indexAtRelease(fullIndex, entry.to));
    const updated = await context.exec(
      cliCommand(context, [
        "update",
        "--directory",
        directory,
        "--to",
        entry.to,
        "--yes",
        "--no-install",
        "--json",
      ]),
      context.workspaceRoot,
    );
    const failures: string[] = [];
    if (updated.exitCode !== 0) {
      failures.push(`update exited ${updated.exitCode}: ${updated.output.slice(-600)}`);
    }
    const conflicts = conflictCount(updated.output);
    if (conflicts !== 0) failures.push(`update reported ${conflicts ?? "unknown"} Conflicts`);
    const releases = await lockedReleases(directory);
    if (!releases.every((release) => release === entry.to)) {
      failures.push(`Lockfile records ${releases.join(", ")} instead of ${entry.to}`);
    }
    failures.push(...(await preservedFailures(directory, prepared.edits)));
    return { label, ok: failures.length === 0, failures };
  } finally {
    await writeIndex(registry, fullIndex);
  }
}

/** The cases the job runs: every Release pair x curated selection x Layout. */
export function buildCases(
  pairs: readonly (readonly [string, string])[],
  combinations: readonly { layout: Layout; modules: readonly string[] }[],
): UpgradeCase[] {
  return pairs.flatMap(([from, to]) =>
    combinations.map((combination) => ({ from, to, ...combination })),
  );
}

/** Runs `cases` one at a time against a scratch copy of the workspace Registry. */
export async function runJob(
  cases: readonly UpgradeCase[],
  context: JobContext,
  report: (result: CaseResult) => void,
): Promise<CaseResult[]> {
  const registry = join(context.scratch, "registry");
  await cp(join(context.workspaceRoot, "registry"), registry, { recursive: true });
  const results: CaseResult[] = [];
  for (const [position, entry] of cases.entries()) {
    context.log(`upgrade ${caseLabel(entry)}`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- cases share one Registry copy
    const result = await runCase(
      entry,
      context,
      registry,
      join(context.scratch, `app-${position}`),
    );
    report(result);
    results.push(result);
  }
  return results;
}
