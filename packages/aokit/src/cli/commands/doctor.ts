import { join, relative, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { findLeftoverStash, removeLeftoverStash } from "../../apply/stash.ts";
import {
  checkProject,
  classifyDrift,
  isNewSibling,
  type DriftEntry,
  type ProjectProblem,
} from "../../drift/index.ts";
import type { Git } from "../../git/git.ts";
import { openGit } from "../../git/index.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { readUpdateMarker } from "../../update/state.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";

const lockfileName = "aokit.lock.json";

const doctorInput = z.object({
  directory: z
    .string()
    .default(".")
    .describe("Project directory that holds aokit.lock.json")
    .register(aokitMeta, { positional: 0, examples: ["."] }),
});

const driftStates = ["pristine", "modified", "deleted", "unknown", "volatile"] as const;
const stateSchema = z.enum(driftStates);

const doctorOutput = z.object({
  clean: z.boolean(),
  lockfileVersion: z.number(),
  upgradedFrom: z.number().nullable(),
  files: z.array(z.object({ path: z.string(), state: stateSchema, fix: z.string().nullable() })),
  byState: z.object({
    modified: z.array(z.string()),
    deleted: z.array(z.string()),
    unknown: z.array(z.string()),
    volatile: z.array(z.string()),
  }),
  problems: z.array(
    z.object({
      kind: z.enum(["cli", "registry", "integrity", "resolver", "deps", "update", "stash"]),
      message: z.string(),
      fix: z.string(),
    }),
  ),
  removedStashes: z.array(z.string()),
});

type DoctorReport = z.infer<typeof doctorOutput>;

function fixFor(entry: DriftEntry): string | null {
  switch (entry.state) {
    case "modified":
      return `aokit restore ${entry.path} (discard your edit) or aokit eject ${entry.path} (keep it)`;
    case "deleted":
      return `aokit restore ${entry.path} (recreate it) or aokit eject ${entry.path} (stop managing it)`;
    case "unknown":
      return isNewSibling(entry.path)
        ? `merge ${entry.path} into ${entry.path.slice(0, -".aokit-new".length)} by hand, then delete it`
        : `delete ${entry.path}, or leave it: aokit never touches files it does not own`;
    case "pristine":
    case "volatile":
      return null;
  }
  return null;
}

async function readProjectLockfile(dir: string) {
  try {
    const parsed = await readLockfile(join(dir, lockfileName));
    if (parsed !== null) return parsed;
  } catch (error) {
    if (error instanceof LockfileError) {
      throw new AokitError(
        "LOCKFILE_MISSING",
        `${lockfileName} is unreadable: ${error.message}`,
        error.fix,
      );
    }
    throw error;
  }
  throw new AokitError(
    "LOCKFILE_MISSING",
    `No ${lockfileName} in ${dir}.`,
    "Run doctor inside an aokit Project, or create one with `aokit create`.",
  );
}

async function removeStashes(dir: string, git: Git | undefined): Promise<string[]> {
  const marker = await readUpdateMarker(dir, git);
  const keep = marker === null ? [] : [marker.stashDirectory];
  const leftovers = (await findLeftoverStash(dir)).filter((path) => !keep.includes(path));
  if (leftovers.length === 0) return [];
  return (await removeLeftoverStash(dir, keep)).map((path) => relative(dir, path));
}

function byState(files: DoctorReport["files"], state: DriftEntry["state"]): string[] {
  return files.filter((file) => file.state === state).map((file) => file.path);
}

function buildReport(
  lockfile: Lockfile,
  upgradedFrom: number | null,
  entries: readonly DriftEntry[],
  projectProblems: readonly ProjectProblem[],
  removedStashes: string[],
): DoctorReport {
  const files = entries.map((entry) => ({ ...entry, fix: fixFor(entry) }));
  const problems: DoctorReport["problems"] = [
    ...projectProblems.map(({ kind, message, fix }) => ({ kind, message, fix })),
    ...removedStashes.map((path) => ({
      kind: "stash" as const,
      message: `An interrupted apply left a stash at ${path}; doctor removed it.`,
      fix: "Check the files an apply may have changed with `aokit diff`.",
    })),
  ];
  const drifted = files.some((file) => !["pristine", "volatile"].includes(file.state));
  return {
    clean: !drifted && problems.length === 0,
    lockfileVersion: lockfile.lockfileVersion,
    upgradedFrom,
    files,
    byState: {
      modified: byState(files, "modified"),
      deleted: byState(files, "deleted"),
      unknown: byState(files, "unknown"),
      volatile: byState(files, "volatile"),
    },
    problems,
    removedStashes,
  };
}

export const doctorCommand = defineCommand({
  name: "doctor",
  description: "Check the health of a Project: Drift states, integrity, Resolver and dependencies",
  input: doctorInput,
  output: doctorOutput,
  async run(context, input) {
    const dir = resolvePath(input.directory);
    const { lockfile, upgradedFrom } = await readProjectLockfile(dir);
    const git = (await openGit(dir)) ?? undefined;
    const [drift, projectProblems] = await Promise.all([
      classifyDrift(dir, lockfile, { git }),
      checkProject(dir, lockfile, { cliVersion: context.version, bundledRegistryPath, git }),
    ]);
    const removedStashes = await removeStashes(dir, git);
    const report = buildReport(
      lockfile,
      upgradedFrom,
      drift.files,
      projectProblems,
      removedStashes,
    );
    const changedItem = projectProblems.find((problem) => problem.code === "REGISTRY_ITEM_CHANGED");
    if (changedItem !== undefined) {
      throw new AokitError("REGISTRY_ITEM_CHANGED", changedItem.message, changedItem.fix, report);
    }
    if (!report.clean) {
      throw new AokitError(
        "DRIFT",
        "The Project differs from its Lockfile or has problems.",
        "Apply the fix command listed next to each problem.",
        report,
      );
    }
    return report;
  },
});
