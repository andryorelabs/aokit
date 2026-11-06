import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import { abortLifecycle } from "../../lifecycle/run.ts";
import { type Confirmer, runLayoutMigrate } from "../../layout/migrate.ts";
import { toAokitError } from "../../project/errors.ts";
import type { CommandContext } from "../command.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const layoutMigrateInput = z.object({
  layout: z
    .enum(["single", "monorepo"])
    .optional()
    .describe("Layout to migrate the Project to")
    .register(aokitMeta, { positional: 0, examples: ["monorepo"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
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
    .describe("Apply without asking; required without a terminal")
    .register(aokitMeta, { flag: "yes", examples: ["--yes"] }),
  allowDirty: z
    .boolean()
    .default(false)
    .describe("Proceed despite uncommitted changes")
    .register(aokitMeta, { flag: "allow-dirty", examples: ["--allow-dirty"] }),
  abort: z
    .boolean()
    .default(false)
    .describe("Undo a conflicted Layout migration")
    .register(aokitMeta, { flag: "abort", examples: ["--abort"] }),
});

const layoutMigrateOutput = z.object({
  directory: z.string(),
  message: z.string(),
  fromLayout: z.string(),
  layout: z.string(),
  changed: z.boolean(),
  applied: z.boolean(),
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
  diff: z.string().optional(),
  aborted: z.boolean(),
  restored: z.array(z.string()),
  warnings: z.array(z.string()),
});

type LayoutMigrateOutput = z.output<typeof layoutMigrateOutput>;

const emptyPlan = { hash: "", changes: [] };

function confirmerFor(context: CommandContext, yes: boolean): Confirmer {
  if (yes) return () => Promise.resolve(true);
  const { prompt } = context;
  if (context.interactive !== true || prompt === undefined) {
    return () => {
      throw new AokitError(
        "MISSING_VALUE",
        "Migrating the Layout needs a confirmation and there is no terminal to ask on.",
        "Pass `--yes` to apply the migration, or `--dry-run` to only see the Plan.",
      );
    };
  }
  return async (summary) =>
    /^y(es)?$/i.test((await prompt(`${summary}\nApply this migration? [y/N] `)).trim());
}

async function abortOutput(directory: string): Promise<LayoutMigrateOutput> {
  const aborted = await abortLifecycle(directory, "layout-migrate");
  return {
    directory,
    message:
      aborted === null
        ? "Nothing to abort."
        : `Aborted the Layout migration; restored ${aborted.restored.length} file(s).`,
    fromLayout: "",
    layout: "",
    changed: false,
    applied: false,
    plan: emptyPlan,
    conflicts: [],
    aborted: aborted !== null,
    restored: aborted?.restored ?? [],
    warnings: [],
  };
}

function describeResult(changed: boolean, applied: boolean, layout: string, from: string): string {
  if (!changed) return `Nothing to migrate: the Project already uses the ${layout} Layout.`;
  if (applied) {
    return `Migrated the Project from the ${from} Layout to ${layout}; run \`bun install\` to refresh the workspace.`;
  }
  return `Plan to migrate the Project from the ${from} Layout to ${layout}; nothing was written.`;
}

export const layoutMigrateCommand = defineCommand({
  name: "layout migrate",
  description: "Migrate a Project to another Layout, keeping the user's edits",
  input: layoutMigrateInput,
  output: layoutMigrateOutput,
  async run(context, input) {
    const directory = resolvePath(input.directory);
    try {
      if (input.abort) return await abortOutput(directory);
      if (input.layout === undefined) {
        throw new AokitError(
          "INVALID_INPUT",
          "A target Layout is required.",
          "Run `aokit layout migrate single` or `aokit layout migrate monorepo`.",
        );
      }
      const result = await runLayoutMigrate({
        directory,
        layout: input.layout,
        dryRun: input.dryRun,
        diff: input.diff,
        allowDirty: input.allowDirty,
        confirm: confirmerFor(context, input.yes),
      });
      if (result.applied && result.conflicts.length > 0) {
        const paths = result.conflicts.map((conflict) => conflict.path);
        throw new AokitError(
          "MERGE_CONFLICTS",
          `${paths.length} file(s) have Conflicts: ${paths.join(", ")}`,
          "resolve the markers (or the `.aokit-new` siblings), then run `aokit doctor`, or run `aokit layout migrate --abort` to undo the migration",
          { conflicts: paths.map((path) => ({ path })) },
        );
      }
      return {
        directory,
        message: describeResult(result.changed, result.applied, result.layout, result.fromLayout),
        fromLayout: result.fromLayout,
        layout: result.layout,
        changed: result.changed,
        applied: result.applied,
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
        ...(result.diff === undefined ? {} : { diff: result.diff }),
        aborted: false,
        restored: [],
        warnings: [...result.warnings],
      };
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
