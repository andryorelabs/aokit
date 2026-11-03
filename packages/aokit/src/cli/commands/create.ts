import { z } from "zod";
import { runCreate } from "../../create/index.ts";
import { AokitError } from "../envelope.ts";
import { defineCommand } from "../command.ts";
import { aokitMeta } from "../meta.ts";

const createInput = z.object({
  directory: z
    .string()
    .default("aokit-app")
    .describe("Directory of the new Project; must be missing or empty")
    .register(aokitMeta, { positional: 0, examples: ["my-app"] }),
  layout: z
    .enum(["single", "monorepo"])
    .optional()
    .describe("Project Layout; `single` by default")
    .register(aokitMeta, { flag: "layout", examples: ["--layout monorepo"] }),
  modules: z
    .string()
    .optional()
    .describe("Comma-separated Modules to install")
    .register(aokitMeta, { flag: "modules", examples: ["--modules oxc,vite-react"] }),
  from: z
    .string()
    .optional()
    .describe(
      "Local aokit.lock.json to create from: its Layout, Module versions, answers and Registries",
    )
    .register(aokitMeta, { flag: "from", examples: ["--from ../app/aokit.lock.json"] }),
  answer: z
    .array(z.string())
    .default([])
    .describe("Module answer as <module.key=value>; repeatable")
    .register(aokitMeta, { flag: "answer", examples: ["--answer next.appRouter=true"] }),
  registry: z
    .string()
    .optional()
    .describe("Local Registry directory; the bundled Registry by default")
    .register(aokitMeta, { flag: "registry", examples: ["--registry ./registry"] }),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Print the change list with Provenance and write nothing")
    .register(aokitMeta, { flag: "dry-run", examples: ["--dry-run"] }),
  diff: z
    .boolean()
    .default(false)
    .describe("Print unified diffs per file; implies --dry-run")
    .register(aokitMeta, { flag: "diff", examples: ["--diff"] }),
  yes: z
    .boolean()
    .default(false)
    .describe("Non-interactive: take defaults, fail on a missing value")
    .register(aokitMeta, { flag: "yes", examples: ["--yes"] }),
  install: z
    .boolean()
    .default(true)
    .describe("Run `bun install` after creating the Project; --no-install skips it")
    .meta({ negatable: true })
    .register(aokitMeta, { flag: "install", examples: ["--no-install"] }),
});

const createOutput = z.object({
  directory: z.string(),
  layout: z.enum(["single", "monorepo"]),
  modules: z.array(z.string()),
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
  diff: z.string().optional(),
  warnings: z.array(z.string()),
  reproduce: z.string(),
});

function splitModules(modules: string | undefined): string[] {
  return (modules ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function assertFromHasNoSelection(input: z.infer<typeof createInput>): void {
  const conflicting = [
    input.layout === undefined ? undefined : "--layout",
    input.modules === undefined ? undefined : "--modules",
    input.registry === undefined ? undefined : "--registry",
  ].filter((flag) => flag !== undefined);
  if (conflicting.length > 0) {
    throw new AokitError(
      "INVALID_INPUT",
      `${conflicting.join(", ")} cannot be combined with --from: the Lockfile fixes the Layout, Module versions and Registries`,
      "drop the flag; only `--answer <module.key=value>` can override a value of the Lockfile",
    );
  }
}

export const createCommand = defineCommand({
  name: "create",
  description: "Create a new Project from a selection of Modules",
  input: createInput,
  output: createOutput,
  run(context, input) {
    if (input.from !== undefined) assertFromHasNoSelection(input);
    return runCreate({
      directory: input.directory,
      layout: input.layout ?? "single",
      from: input.from,
      modules: splitModules(input.modules),
      answers: input.answer,
      registry: input.registry,
      dryRun: input.dryRun,
      diff: input.diff,
      install: input.install,
      version: context.version,
      env: context.env,
    });
  },
});
