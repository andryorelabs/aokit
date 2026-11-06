import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { lockfileName, type ConflictWrite } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { cliVersion } from "../cli/version.ts";
import { lockfileDriftOf } from "../drift/drift-of.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { Plan } from "../engine/plan.ts";
import { runLifecycle } from "../lifecycle/index.ts";
import { readLockfile } from "../lockfile/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { BuiltProject } from "../pipeline/build.ts";
import { renderFromLockfile } from "../pipeline/index.ts";
import { toAokitError } from "../project/errors.ts";
import { bundledRegistryPath } from "../registry/bundled.ts";
import { layoutRenames } from "./renames.ts";

/** Asks whether to apply a Layout migration; resolves `false` to decline. */
export type Confirmer = (summary: string) => Promise<boolean>;

/** Inputs of {@link runLayoutMigrate}. */
export interface LayoutMigrateInput {
  readonly directory: string;
  readonly layout: LayoutName;
  readonly dryRun: boolean;
  readonly diff: boolean;
  readonly allowDirty: boolean;
  readonly confirm: Confirmer;
}

/** What {@link runLayoutMigrate} did. */
export interface LayoutMigrateResult {
  readonly fromLayout: LayoutName;
  readonly layout: LayoutName;
  /** False when the Project already had the requested Layout and nothing was written. */
  readonly changed: boolean;
  readonly applied: boolean;
  readonly plan: Plan | undefined;
  readonly conflicts: readonly ConflictWrite[];
  readonly warnings: readonly string[];
  readonly diff?: string;
}

async function readProjectLockfile(directory: string): Promise<Lockfile> {
  const parsed = await readLockfile(join(directory, lockfileName));
  if (parsed === null) {
    throw new AokitError(
      "LOCKFILE_MISSING",
      `No ${lockfileName} found in "${directory}".`,
      "Run the command inside an aokit Project, or create one with `aokit create`.",
    );
  }
  return parsed.lockfile;
}

async function filesUnder(directory: string, relative: string): Promise<string[]> {
  const entries = await readdir(join(directory, relative), { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" || entry.name === ".git"
          ? []
          : filesUnder(directory, path);
      }
      return [path];
    }),
  );
  return nested.flat();
}

/**
 * Files on disk that no Lockfile entry owns, found under the directories the moved files leave.
 * They stay where they are; the Project root is not scanned.
 */
async function unmanagedFiles(
  directory: string,
  lockfile: Lockfile,
  movedFrom: readonly string[],
): Promise<string[]> {
  const directories = new Set(
    movedFrom.filter((path) => path.includes("/")).map((path) => path.split("/")[0] ?? ""),
  );
  directories.delete("");
  const found = await Promise.all([...directories].map((parent) => filesUnder(directory, parent)));
  const unmanaged = new Set(found.flat().filter((path) => lockfile.files[path] === undefined));
  return [...unmanaged].toSorted();
}

function summaryOf(plan: Plan, layout: LayoutName): string {
  const lines = plan.changes.map((change) =>
    change.type === "rename"
      ? `  rename ${change.renamedFrom} -> ${change.path}`
      : `  ${change.type} ${change.path}`,
  );
  return [`Migrate to the ${layout} Layout:`, ...lines].join("\n");
}

/**
 * Migrates a Project to another Layout: renders the Lockfile at its Layout and at the new one,
 * pairs files by Provenance and runs the lifecycle merge so the user's edits follow their files.
 * Files outside the Lockfile stay in place and are reported as warnings.
 */
export async function runLayoutMigrate(input: LayoutMigrateInput): Promise<LayoutMigrateResult> {
  try {
    const lockfile = await readProjectLockfile(input.directory);
    if (lockfile.layout === input.layout) {
      return {
        fromLayout: lockfile.layout,
        layout: input.layout,
        changed: false,
        applied: false,
        plan: undefined,
        conflicts: [],
        warnings: [],
      };
    }
    const renames = new Map<string, string>();
    const seedMoves = new Map<string, string>();
    const renderAt = (source: Lockfile): Promise<BuiltProject> =>
      renderFromLockfile(source, {
        projectDir: input.directory,
        bundledRegistryPath,
        cliVersion,
      });
    const result = await runLifecycle({
      dir: input.directory,
      driftOf: lockfileDriftOf,
      allowDirty: input.allowDirty,
      dryRun: input.dryRun,
      diff: input.diff,
      install: false,
      renames,
      seedMoves,
      keepStashOnConflict: true,
      markerKind: "layout-migrate",
      render: {
        base: (current) => renderAt(current),
        async next(current, base) {
          const next = await renderAt({ ...current, layout: input.layout });
          if (base !== undefined) {
            const paired = layoutRenames(base.plan, next.plan);
            for (const [from, to] of paired.renames) renames.set(from, to);
            for (const [from, to] of paired.seedMoves) seedMoves.set(from, to);
          }
          return next;
        },
      },
      afterMerge: async (merged) => {
        if (input.dryRun || input.diff) return merged;
        if (!(await input.confirm(summaryOf(merged.plan, input.layout)))) {
          throw new AokitError(
            "INTERRUPTED",
            "The Layout migration was not confirmed.",
            "Nothing was written.",
          );
        }
        return merged;
      },
    });
    const unmanaged = await unmanagedFiles(input.directory, lockfile, [
      ...renames.keys(),
      ...seedMoves.keys(),
    ]);
    return {
      fromLayout: lockfile.layout,
      layout: input.layout,
      changed: true,
      applied: result.applied,
      plan: result.plan,
      conflicts: result.conflicts,
      warnings: [
        ...result.warnings,
        ...unmanaged.map(
          (path) =>
            `${path} is not managed by aokit and stays where it is; move it yourself if needed.`,
        ),
      ],
      ...(result.diff === undefined ? {} : { diff: result.diff }),
    };
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}
