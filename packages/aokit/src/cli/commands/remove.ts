import { join, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { z } from "zod";
import { lockfileName } from "../../apply/index.ts";
import { lockfileDriftOf } from "../../drift/drift-of.ts";
import type { PlanChange } from "../../engine/plan.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { runLifecycle } from "../../lifecycle/index.ts";
import { renderFromLockfile } from "../../pipeline/index.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import type { LocalRegistry } from "../../registry/index.ts";
import { resolve as resolveModules } from "../../resolver/resolve.ts";
import { fromResolveError, toAokitError } from "../../project/errors.ts";
import { openProjectRegistry } from "../../project/registry.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { lockfileMissingError } from "../errors.ts";
import { aokitMeta } from "../meta.ts";

const removeInput = z.object({
  module: z
    .string()
    .describe("Name of the Selected Module to remove")
    .register(aokitMeta, { positional: 0, examples: ["knip"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
  cascade: z
    .boolean()
    .default(false)
    .describe("Also remove every Module that requires only this one")
    .register(aokitMeta, { flag: "cascade", examples: ["--cascade"] }),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Print the Plan and write nothing")
    .register(aokitMeta, { flag: "dry-run", examples: ["--dry-run"] }),
  diff: z
    .boolean()
    .default(false)
    .describe("Print unified diffs per file; implies --dry-run")
    .register(aokitMeta, { flag: "diff", examples: ["--diff"] }),
  yes: z
    .boolean()
    .default(false)
    .describe("Non-interactive: also remove orphaned Modules without asking")
    .register(aokitMeta, { flag: "yes", examples: ["--yes"] }),
  allowDirty: z
    .boolean()
    .default(false)
    .describe("Proceed despite uncommitted changes")
    .register(aokitMeta, { flag: "allow-dirty", examples: ["--allow-dirty"] }),
  install: z
    .boolean()
    .default(true)
    .describe("Run `bun install` when package.json changed; --no-install skips it")
    .meta({ negatable: true })
    .register(aokitMeta, { flag: "install", examples: ["--no-install"] }),
});

const removeOutput = z.object({
  directory: z.string(),
  module: z.string(),
  removed: z.array(z.string()),
  dependents: z.array(z.string()),
  orphans: z.array(z.string()),
  applied: z.boolean(),
  installed: z.boolean(),
  plan: z.object({
    hash: z.string(),
    changes: z.array(
      z.object({
        type: z.enum(["create", "update", "delete", "rename"]),
        path: z.string(),
        mode: z.string().nullable(),
        ownership: z.enum(["managed", "seed", "ejected"]),
        provenance: z.array(z.object({ module: z.string(), source: z.string() })),
      }),
    ),
  }),
  conflicts: z.array(z.string()),
  diff: z.string().optional(),
  warnings: z.array(z.string()),
});

/** The Modules a `remove` takes out of the Project. */
interface RemovalSet {
  /** Every Module that leaves: the target, its cascaded dependents, then the orphans. */
  readonly removed: string[];
  /** The Selected Modules that required only the target. */
  readonly dependents: string[];
  /** Unselected Modules nothing needs any more. */
  readonly orphans: string[];
}

const unmetCodes = new Set(["requirement_unmet", "extension_point_unmet"]);

function describeProvenance(entry: PlanChange["provenance"][number]["entry"]): string {
  if (entry.kind === "file") return `file ${entry.from}`;
  return entry.kind === "op" ? `op ${entry.op}` : entry.kind;
}

function describePlanChange(change: PlanChange) {
  return {
    type: change.type,
    path: change.path,
    mode: change.mode ?? null,
    ownership: change.ownership,
    provenance: change.provenance.map((entry) => ({
      module: entry.module,
      source: describeProvenance(entry.entry),
    })),
  };
}

async function readProjectLockfile(directory: string): Promise<Lockfile> {
  let parsed;
  try {
    parsed = await readLockfile(join(directory, lockfileName));
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("LOCKFILE_MISSING", thrown.message, thrown.fix);
    }
    throw thrown;
  }
  if (parsed === null) {
    throw lockfileMissingError("run the command inside an aokit Project, or pass --directory");
  }
  return parsed.lockfile;
}

async function lockedManifests(
  lockfile: Lockfile,
  directory: string,
  cliVersion: string,
): Promise<ModuleManifest[]> {
  const loaded = await Promise.all(
    Object.keys(lockfile.registries).map(
      async (name) =>
        [
          name,
          await openProjectRegistry(lockfile, {
            projectDir: directory,
            cliVersion,
            bundledRegistryPath,
            registry: name,
          }),
        ] as const,
    ),
  );
  const registries = new Map<string, LocalRegistry>(loaded);
  return Object.entries(lockfile.modules)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, entry]) => {
      const found = registries.get(entry.registry)?.version(name, entry.version);
      if (found === undefined) {
        throw new AokitError(
          "MODULE_VERSION_UNAVAILABLE",
          `Module ${name}@${entry.version} is not available in Registry "${entry.registry}".`,
          `run \`aokit recopy\` to render ${name} at the latest version the Registry offers`,
        );
      }
      return found.manifest;
    });
}

function assertSelected(lockfile: Lockfile, name: string): void {
  const entry = lockfile.modules[name];
  if (entry === undefined) {
    throw new AokitError(
      "NOT_IN_LOCKFILE",
      `Module \`${name}\` is not in ${lockfileName}`,
      "run `aokit doctor` to see the Modules of this Project",
    );
  }
  if (!entry.selected) {
    throw new AokitError(
      "NOT_SELECTED",
      `Module \`${name}\` is only installed as a dependency of another Module`,
      "remove the Module that needs it; it is removed as an orphan once nothing needs it",
    );
  }
}

/** Grows the removal set with every Module that would lose a requirement, until the rest resolves. */
function findRemoval(
  lockfile: Lockfile,
  manifests: readonly ModuleManifest[],
  target: string,
): RemovalSet {
  const removed = [target];
  const dependents: string[] = [];
  for (;;) {
    const remaining = manifests.filter((manifest) => !removed.includes(manifest.name));
    const selection = remaining
      .map((manifest) => manifest.name)
      .filter((name) => lockfile.modules[name]?.selected === true);
    const resolved = resolveModules({ modules: selection }, remaining, { acceptSuggestions: true });
    if (resolved.ok) {
      const needed = new Set(resolved.modules.map((module) => module.name));
      const orphans = remaining.map((m) => m.name).filter((name) => !needed.has(name));
      return { removed: [...removed, ...orphans], dependents, orphans };
    }
    const failing = resolved.error.module;
    if (
      failing === undefined ||
      !unmetCodes.has(resolved.error.code) ||
      !remaining.some((manifest) => manifest.name === failing)
    ) {
      throw fromResolveError(resolved.error);
    }
    removed.push(failing);
    if (lockfile.modules[failing]?.selected === true) dependents.push(failing);
  }
}

function assertCascadeAllowed(removal: RemovalSet, target: string, cascade: boolean): void {
  if (removal.dependents.length === 0 || cascade) return;
  throw new AokitError(
    "DEPENDENTS_EXIST",
    `Module \`${removal.dependents.join("`, `")}\` requires \`${target}\`, so \`${target}\` cannot be removed alone`,
    `remove the dependents first, or run \`aokit remove ${target} --cascade\` to remove ${[target, ...removal.dependents].join(", ")}`,
    { module: target, dependents: removal.dependents },
  );
}

function assertOrphansConfirmed(removal: RemovalSet, yes: boolean): void {
  if (removal.orphans.length === 0 || yes) return;
  throw new AokitError(
    "MISSING_VALUE",
    `removing this leaves orphaned Modules nothing needs any more: ${removal.orphans.join(", ")}`,
    "pass `--yes` to remove them as well",
    { orphans: removal.orphans },
  );
}

function withoutModules(lockfile: Lockfile, removed: readonly string[]): Lockfile {
  return {
    ...lockfile,
    modules: Object.fromEntries(
      Object.entries(lockfile.modules).filter(([name]) => !removed.includes(name)),
    ),
  };
}

export const removeCommand = defineCommand({
  name: "remove",
  description: "Remove a Module from a Project",
  input: removeInput,
  output: removeOutput,
  async run(context, input) {
    const directory = resolvePath(input.directory);
    try {
      const lockfile = await readProjectLockfile(directory);
      assertSelected(lockfile, input.module);
      const manifests = await lockedManifests(lockfile, directory, context.version);
      const removal = findRemoval(lockfile, manifests, input.module);
      assertCascadeAllowed(removal, input.module, input.cascade);
      assertOrphansConfirmed(removal, input.yes);
      const options = { projectDir: directory, bundledRegistryPath, cliVersion: context.version };
      const result = await runLifecycle({
        dir: directory,
        driftOf: lockfileDriftOf,
        allowDirty: input.allowDirty,
        dryRun: input.dryRun,
        diff: input.diff,
        install: input.install,
        render: {
          base: (current) => renderFromLockfile(current, options),
          next: (current) => renderFromLockfile(withoutModules(current, removal.removed), options),
        },
      });
      const conflicts = result.conflicts.map((conflict) => conflict.path);
      if (result.applied && conflicts.length > 0) {
        throw new AokitError(
          "MERGE_CONFLICTS",
          `removing \`${input.module}\` left ${conflicts.length} Conflict(s): ${conflicts.join(", ")}`,
          "resolve the markers (or the .aokit-new siblings) by hand, then run `aokit doctor`",
          { conflicts },
        );
      }
      return {
        directory,
        module: input.module,
        removed: removal.removed,
        dependents: removal.dependents,
        orphans: removal.orphans,
        applied: result.applied,
        installed: result.installed,
        plan: { hash: result.plan.hash, changes: result.plan.changes.map(describePlanChange) },
        conflicts,
        ...(result.diff === undefined ? {} : { diff: result.diff }),
        warnings: result.warnings,
      };
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
