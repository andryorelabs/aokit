import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { toAokitError } from "../../project/errors.ts";
import { runUpdate, type UpdateResult } from "../../update/run.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const updateInput = z.object({
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
  to: z
    .string()
    .optional()
    .describe("Release to update to; defaults to the latest one the Registry lists")
    .register(aokitMeta, { flag: "to", examples: ["--to 2026.11.1"] }),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Print the change list and write nothing")
    .register(aokitMeta, { flag: "dry-run", examples: ["--dry-run"] }),
  diff: z
    .boolean()
    .default(false)
    .describe("Print unified diffs per file; implies --dry-run")
    .register(aokitMeta, { flag: "diff", examples: ["--diff"] }),
  yes: z
    .boolean()
    .default(false)
    .describe("Apply without asking; required without a terminal")
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

const updateOutput = z.object({
  directory: z.string(),
  upToDate: z.boolean(),
  message: z.string(),
  fromRelease: z.string(),
  release: z.string(),
  applied: z.boolean(),
  installed: z.boolean(),
  plan: z.object({
    hash: z.string(),
    changes: z.array(
      z.object({
        type: z.enum(["create", "update", "delete", "rename"]),
        path: z.string(),
        renamedFrom: z.string().nullable(),
        ownership: z.enum(["managed", "seed", "ejected"]),
      }),
    ),
  }),
  conflicts: z.array(z.object({ path: z.string() })),
  keptDeps: z.array(
    z.object({
      name: z.string(),
      kept: z.string(),
      available: z.string(),
      reason: z.enum(["pinned", "user"]),
    }),
  ),
  migrations: z.array(
    z.object({
      module: z.string(),
      stage: z.enum(["before", "after"]),
      from: z.string(),
      to: z.string(),
      script: z.string(),
    }),
  ),
  diff: z.string().optional(),
  warnings: z.array(z.string()),
});

async function askToConfirm(summary: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await terminal.question(`${summary}\nApply this update? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

function describe(result: UpdateResult): string {
  if (result.upToDate) return `Nothing to update: the Project is on Release ${result.release}.`;
  if (result.applied) return `Updated from Release ${result.fromRelease} to ${result.release}.`;
  return `Plan to update from Release ${result.fromRelease} to ${result.release}; nothing was written.`;
}

function outputOf(directory: string, result: UpdateResult): z.output<typeof updateOutput> {
  return {
    directory,
    upToDate: result.upToDate,
    message: describe(result),
    fromRelease: result.fromRelease,
    release: result.release,
    applied: result.applied,
    installed: result.installed,
    plan: {
      hash: result.plan?.hash ?? "",
      changes: (result.plan?.changes ?? []).map((change) => ({
        type: change.type,
        path: change.path,
        renamedFrom: change.renamedFrom ?? null,
        ownership: change.ownership,
      })),
    },
    conflicts: result.conflicts.map((conflict) => ({ path: conflict.path })),
    keptDeps: [...result.keptDeps],
    migrations: [...result.migrations],
    ...(result.diff === undefined ? {} : { diff: result.diff }),
    warnings: [...result.warnings],
  };
}

export const updateCommand = defineCommand({
  name: "update",
  description: "Update a Project to a newer Release",
  input: updateInput,
  output: updateOutput,
  async run(context, input) {
    const directory = resolvePath(input.directory);
    try {
      const result = await runUpdate({
        dir: directory,
        allowDirty: input.allowDirty,
        dryRun: input.dryRun,
        diff: input.diff,
        yes: input.yes,
        install: input.install,
        cliVersion: context.version,
        ...(input.to === undefined ? {} : { to: input.to }),
        ...(process.stdin.isTTY ? { confirm: askToConfirm } : {}),
      });
      if (result.applied && result.conflicts.length > 0) {
        const paths = result.conflicts.map((conflict) => conflict.path);
        throw new AokitError(
          "MERGE_CONFLICTS",
          `${paths.length} file(s) have Conflicts: ${paths.join(", ")}`,
          "resolve the markers (or the `.aokit-new` siblings), then run `aokit doctor`, or run `aokit update --abort` to undo the update",
          { conflicts: paths.map((path) => ({ path })) },
        );
      }
      return outputOf(directory, result);
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
