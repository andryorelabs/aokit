import { join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { lockfileName } from "../../apply/index.ts";
import { toPlanChange } from "../../create/index.ts";
import { classifyDrift } from "../../drift/index.ts";
import { openGit } from "../../git/index.ts";
import { runLifecycle } from "../../lifecycle/index.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import type { DriftOf } from "../../merge/index.ts";
import type { BuiltProject } from "../../pipeline/build.ts";
import { renderFromLockfile } from "../../pipeline/index.ts";
import { toAokitError } from "../../project/errors.ts";
import { openProjectRegistry } from "../../project/registry.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { lockfileMissingError } from "../errors.ts";
import { aokitMeta } from "../meta.ts";

const recopyInput = z.object({
  directory: z
    .string()
    .default(".")
    .describe("Project directory that holds aokit.lock.json")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
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
    .describe("Non-interactive: apply without asking")
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

const recopyOutput = z.object({
  directory: z.string(),
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
  substitutions: z.array(
    z.object({ module: z.string(), locked: z.string(), rendered: z.string() }),
  ),
  diff: z.string().optional(),
  warnings: z.array(z.string()),
});

type RecopyReport = z.infer<typeof recopyOutput>;
type Substitution = RecopyReport["substitutions"][number];

interface UnavailableData {
  readonly module: string;
  readonly version: string;
  readonly registry: string;
}

function unavailableModule(thrown: unknown): UnavailableData | undefined {
  if (!(thrown instanceof AokitError) || thrown.code !== "MODULE_VERSION_UNAVAILABLE") {
    return undefined;
  }
  const data = thrown.data;
  if (
    typeof data === "object" &&
    data !== null &&
    "module" in data &&
    typeof data.module === "string" &&
    "version" in data &&
    typeof data.version === "string" &&
    "registry" in data &&
    typeof data.registry === "string"
  ) {
    return { module: data.module, version: data.version, registry: data.registry };
  }
  return undefined;
}

async function latestVersion(
  lockfile: Lockfile,
  unavailable: UnavailableData,
  directory: string,
  cliVersion: string,
): Promise<string | undefined> {
  if (lockfile.registries[unavailable.registry] === undefined) return undefined;
  const registry = await openProjectRegistry(lockfile, {
    projectDir: directory,
    cliVersion,
    bundledRegistryPath,
    registry: unavailable.registry,
    includeNewest: true,
  });
  return registry.modules.get(unavailable.module)?.manifest.version;
}

/**
 * Renders at the Lockfile versions; when a locked Module version is gone from its Registry, renders
 * that Module at the latest version instead and records the substitution.
 */
async function renderNext(
  lockfile: Lockfile,
  directory: string,
  cliVersion: string,
  substitutions: Substitution[],
  overrides: Readonly<Record<string, string>> = {},
): Promise<BuiltProject> {
  try {
    return await renderFromLockfile(lockfile, {
      projectDir: directory,
      bundledRegistryPath,
      cliVersion,
      versionOverride: overrides,
    });
  } catch (thrown) {
    const unavailable = unavailableModule(thrown);
    if (unavailable === undefined || overrides[unavailable.module] !== undefined) throw thrown;
    const latest = await latestVersion(lockfile, unavailable, directory, cliVersion);
    if (latest === undefined) throw thrown;
    substitutions.push({
      module: unavailable.module,
      locked: unavailable.version,
      rendered: latest,
    });
    return renderNext(lockfile, directory, cliVersion, substitutions, {
      ...overrides,
      [unavailable.module]: latest,
    });
  }
}

async function readProjectLockfile(directory: string): Promise<Lockfile> {
  try {
    const parsed = await readLockfile(join(directory, lockfileName));
    if (parsed !== null) return parsed.lockfile;
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("LOCKFILE_MISSING", thrown.message, thrown.fix);
    }
    throw thrown;
  }
  throw lockfileMissingError("Run the command inside an aokit Project, or pass --directory.");
}

async function driftOfProject(directory: string, lockfile: Lockfile): Promise<DriftOf> {
  const git = await openGit(directory);
  const report = await classifyDrift(directory, lockfile, { git: git ?? undefined });
  const states = new Map(report.files.map((entry) => [entry.path, entry.state]));
  return ({ path }) => states.get(path) ?? "unknown";
}

function substitutionNote({ module, locked, rendered }: Substitution): string {
  return `${module}@${locked} is no longer in the Registry; rendered ${module}@${rendered} instead.`;
}

export const recopyCommand = defineCommand({
  name: "recopy",
  description: "Re-render the Project at the Lockfile versions and merge it with an empty base",
  input: recopyInput,
  output: recopyOutput,
  async run(context, input) {
    const directory = resolvePath(input.directory);
    const lockfile = await readProjectLockfile(directory);
    const substitutions: Substitution[] = [];
    try {
      const driftOf = await driftOfProject(directory, lockfile);
      const result = await runLifecycle({
        dir: directory,
        driftOf,
        allowDirty: input.allowDirty,
        dryRun: input.dryRun,
        diff: input.diff,
        install: input.install,
        render: {
          base: () => Promise.resolve(undefined),
          next: (current) => renderNext(current, directory, context.version, substitutions),
        },
      });
      const report: RecopyReport = {
        directory,
        applied: result.applied,
        installed: result.installed,
        plan: {
          hash: result.plan.hash,
          changes: result.plan.changes.map(toPlanChange),
        },
        conflicts: result.conflicts.map((conflict) => conflict.path),
        substitutions,
        ...(result.diff === undefined ? {} : { diff: result.diff }),
        warnings: [...substitutions.map(substitutionNote), ...result.warnings],
      };
      if (result.applied && result.conflicts.length > 0) {
        throw new AokitError(
          "MERGE_CONFLICTS",
          `${result.conflicts.length} file(s) conflict: ${report.conflicts.join(", ")}`,
          "resolve the conflict markers (or the .aokit-new siblings) by hand, then run `aokit doctor`",
          report,
        );
      }
      return report;
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
