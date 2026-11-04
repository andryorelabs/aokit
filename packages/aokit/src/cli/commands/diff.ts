import { readFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { structuredPatch } from "diff";
import { z } from "zod";
import type { PlanChange } from "../../engine/plan.ts";
import { type FileContent, Vfs, compareByCodepoint } from "../../engine/vfs.ts";
import { loadUserTree } from "../../lifecycle/migration-stage.ts";
import { modulesInOrder } from "../../update/run.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { runMigrations } from "../../migrations/index.ts";
import { renderFromLockfile } from "../../pipeline/index.ts";
import { unifiedDiff } from "../../project/diff.ts";
import { toAokitError } from "../../project/errors.ts";
import { openProjectRegistry } from "../../project/registry.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import { resolveUpdateTarget } from "../../update/target.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const lockfileFileName = "aokit.lock.json";
const contextLines = 3;

const diffInput = z.object({
  directory: z
    .string()
    .default(".")
    .describe("Project directory that holds aokit.lock.json")
    .register(aokitMeta, { positional: 0, examples: ["./my-app"] }),
  to: z
    .string()
    .min(1)
    .optional()
    .describe("Release to render and compare the working tree against; writes nothing")
    .register(aokitMeta, { flag: "to", examples: ["--to 2026.11.1"] }),
});

const hunkOutput = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(z.string()),
});

const diffOutput = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["modified", "missing", "removed"]),
      binary: z.boolean(),
      hunks: z.array(hunkOutput),
    }),
  ),
  diff: z.string(),
});

function decodeWorkingFile(bytes: Uint8Array): FileContent {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch {
    return bytes;
  }
}

async function readWorkingFile(projectDir: string, path: string): Promise<FileContent | undefined> {
  try {
    return decodeWorkingFile(new Uint8Array(await readFile(join(projectDir, path))));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw new AokitError(
      "IO_ERROR",
      `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      "Check the file permissions and run the command again.",
    );
  }
}

async function loadLockfile(projectDir: string): Promise<Lockfile> {
  try {
    const parsed = await readLockfile(join(projectDir, lockfileFileName));
    if (parsed === null) {
      throw new AokitError(
        "INVALID_INPUT",
        `No ${lockfileFileName} in ${projectDir}.`,
        "Run the command from an aokit Project, or pass its directory.",
      );
    }
    return parsed.lockfile;
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("INVALID_INPUT", thrown.message, thrown.fix);
    }
    throw thrown;
  }
}

function contentEquals(left: FileContent, right: FileContent): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function hunksOf(change: PlanChange): z.output<typeof hunkOutput>[] {
  const before = change.previousContent ?? "";
  if (
    typeof before !== "string" ||
    (change.content !== undefined && typeof change.content !== "string")
  ) {
    return [];
  }
  const patch = structuredPatch(
    change.path,
    change.path,
    before,
    change.content ?? "",
    undefined,
    undefined,
    { context: contextLines },
  );
  return patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));
}

async function managedChanges(
  projectDir: string,
  lockfile: Lockfile,
  vfs: Vfs,
): Promise<PlanChange[]> {
  const paths = vfs.paths().filter((path) => {
    const ownership = lockfile.files[path]?.mode ?? vfs.get(path)?.ownership;
    return ownership === "managed" && path !== lockfileFileName;
  });
  const working = await Promise.all(paths.map((path) => readWorkingFile(projectDir, path)));
  const changes: PlanChange[] = [];
  for (const [position, path] of paths.entries()) {
    const expected = vfs.read(path);
    const actual = working[position];
    if (expected === undefined || (actual !== undefined && contentEquals(expected, actual))) {
      continue;
    }
    changes.push({
      type: actual === undefined ? "delete" : "update",
      path,
      previousContent: expected,
      ...(actual === undefined ? {} : { content: actual }),
      ownership: "managed",
      mode: undefined,
      provenance: [],
    });
  }
  return changes;
}

function isManaged(lockfile: Lockfile, vfs: Vfs, path: string): boolean {
  const ownership = lockfile.files[path]?.mode ?? vfs.get(path)?.ownership;
  return ownership === "managed" && path !== lockfileFileName;
}

async function targetChanges(
  projectDir: string,
  lockfile: Lockfile,
  targetVfs: Vfs,
): Promise<PlanChange[]> {
  const targetPaths = targetVfs.paths().filter((path) => isManaged(lockfile, targetVfs, path));
  const removedPaths = Object.keys(lockfile.files).filter(
    (path) => !targetVfs.has(path) && isManaged(lockfile, targetVfs, path),
  );
  const paths = [...targetPaths, ...removedPaths].toSorted(compareByCodepoint);
  const working = await Promise.all(paths.map((path) => readWorkingFile(projectDir, path)));
  const changes: PlanChange[] = [];
  for (const [position, path] of paths.entries()) {
    const actual = working[position];
    const expected = targetVfs.read(path);
    if (expected === undefined && actual === undefined) {
      continue;
    }
    if (expected !== undefined && actual !== undefined && contentEquals(expected, actual)) {
      continue;
    }
    changes.push({
      type: actual === undefined ? "create" : expected === undefined ? "delete" : "update",
      path,
      ...(actual === undefined ? {} : { previousContent: actual }),
      ...(expected === undefined ? {} : { content: expected }),
      ownership: "managed",
      mode: undefined,
      provenance: [],
    });
  }
  return changes;
}

function targetStatus(change: PlanChange): "modified" | "missing" | "removed" {
  if (change.type === "create") {
    return "missing";
  }
  return change.type === "delete" ? "removed" : "modified";
}

async function renderTarget(
  projectDir: string,
  lockfile: Lockfile,
  to: string,
  cliVersion: string,
): Promise<Vfs> {
  const options = { projectDir, bundledRegistryPath, cliVersion };
  const registryName = Object.keys(lockfile.registries)[0];
  if (registryName === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      `${lockfileFileName} lists no Registry.`,
      "Restore aokit.lock.json from version control.",
    );
  }
  const registry = await openProjectRegistry(lockfile, { ...options, registry: registryName });
  const target = resolveUpdateTarget(lockfile, registry, to);
  const userVfs = await loadUserTree(projectDir);
  const migrated = await runMigrations({
    stage: "before",
    modules: modulesInOrder(lockfile, registry, target),
    vfs: userVfs,
    answers: Object.fromEntries(
      Object.entries(lockfile.modules).map(([name, entry]) => [name, entry.answers]),
    ),
    context: { now: new Date(0), random: () => 0 },
    registry,
  });
  const rendered = await renderFromLockfile(lockfile, {
    ...options,
    release: target.release,
    versionOverride: target.versions,
    answersOverride: migrated.answers,
  });
  return rendered.plan.vfs;
}

async function runDiffToRelease(
  projectDir: string,
  lockfile: Lockfile,
  to: string,
  cliVersion: string,
): Promise<z.output<typeof diffOutput>> {
  const targetVfs = await renderTarget(projectDir, lockfile, to, cliVersion);
  const changes = await targetChanges(projectDir, lockfile, targetVfs);
  return {
    files: changes.map((change) => ({
      path: change.path,
      status: targetStatus(change),
      binary: typeof (change.content ?? change.previousContent) !== "string",
      hunks: hunksOf(change),
    })),
    diff: unifiedDiff({ changes }),
  };
}

async function runDiff(
  directory: string,
  to: string | undefined,
  cliVersion: string,
): Promise<z.output<typeof diffOutput>> {
  const projectDir = resolvePath(directory);
  const lockfile = await loadLockfile(projectDir);
  if (to !== undefined) {
    return runDiffToRelease(projectDir, lockfile, to, cliVersion);
  }
  const rendered = await renderFromLockfile(lockfile, {
    projectDir,
    bundledRegistryPath,
    cliVersion,
  });
  const changes = await managedChanges(projectDir, lockfile, rendered.plan.vfs);
  return {
    files: changes.map((change) => ({
      path: change.path,
      status: change.type === "delete" ? "missing" : "modified",
      binary: typeof (change.content ?? change.previousContent) !== "string",
      hunks: hunksOf(change),
    })),
    diff: unifiedDiff({ changes }),
  };
}

export const diffCommand = defineCommand({
  name: "diff",
  description: "Show how managed files differ from their Render, or from a target Release",
  input: diffInput,
  output: diffOutput,
  async run(context, input) {
    try {
      return await runDiff(input.directory, input.to, context.version);
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
