import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { z } from "zod";
import { hashFileBytes, volatileHash } from "../../drift/hash.ts";
import type { AnswerValue } from "../../engine/interpolate.ts";
import type { PlanChange } from "../../engine/plan.ts";
import { formatterForSelection } from "../../format/index.ts";
import { runLifecycle } from "../../lifecycle/index.ts";
import type { DriftOf } from "../../merge/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import type { BuiltProject } from "../../pipeline/build.ts";
import { type PipelineModule, buildProject, renderFromLockfile } from "../../pipeline/index.ts";
import { type AnswerMap, completeAnswers, parseAnswers } from "../../project/answers.ts";
import { fromResolveError, toAokitError } from "../../project/errors.ts";
import { loadRegistry } from "../../project/registry.ts";
import { resolve as resolveModules } from "../../resolver/resolve.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const bundledRegistryPath = join(import.meta.dir, "..", "..", "..", "..", "..", "registry");
const fixedNow = new Date(0);

const addInput = z.object({
  modules: z
    .array(z.string())
    .min(1)
    .describe("Modules to add, by name")
    .register(aokitMeta, { positional: 0, examples: ["knip"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
  answer: z
    .array(z.string())
    .default([])
    .describe("Answer of an added Module as <module.key=value>; repeatable")
    .register(aokitMeta, { flag: "answer", examples: ["--answer next.appRouter=true"] }),
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

const provenanceOutput = z.array(z.object({ module: z.string(), source: z.string() }));

const addOutput = z.object({
  directory: z.string(),
  added: z.array(z.string()),
  pulledIn: z.array(z.string()),
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
        provenance: provenanceOutput,
      }),
    ),
  }),
  conflicts: z.array(z.object({ path: z.string(), provenance: provenanceOutput })),
  diff: z.string().optional(),
  warnings: z.array(z.string()),
  reproduce: z.string(),
});

type Provenance = z.infer<typeof provenanceOutput>;

/** What the next Render decided; filled while the lifecycle runs. */
interface AddState {
  added: string[];
  pulledIn: string[];
  answers: AnswerMap;
  next: BuiltProject | undefined;
}

const driftOf: DriftOf = ({ entry, user }) => {
  if (entry === undefined) return user === undefined ? "deleted" : "unknown";
  if (user === undefined) return "deleted";
  if (entry.hash === volatileHash) return "volatile";
  const bytes = typeof user === "string" ? new TextEncoder().encode(user) : user;
  return hashFileBytes(bytes) === entry.hash ? "pristine" : "modified";
};

function describeEntry(entry: PlanChange["provenance"][number]["entry"]): string {
  if (entry.kind === "file") return `file ${entry.from}`;
  return entry.kind === "op" ? `op ${entry.op}` : entry.kind;
}

function provenanceOf(changes: readonly PlanChange[], path: string): Provenance {
  const change = changes.find((candidate) => candidate.path === path);
  return (change?.provenance ?? []).map((entry) => ({
    module: entry.module,
    source: describeEntry(entry.entry),
  }));
}

function registrySource(source: string, projectDirectory: string): string {
  if (source === "bundled") return bundledRegistryPath;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) {
    throw new AokitError(
      "INVALID_INPUT",
      `Registry source "${source}" is a URL, and remote Registries are not supported yet.`,
      "Use a local Registry path or the bundled Registry.",
    );
  }
  return isAbsolute(source) ? source : resolvePath(projectDirectory, source);
}

function alreadySelected(lockfile: Lockfile, requested: readonly string[]): void {
  const present = requested.filter((name) => lockfile.modules[name]?.selected === true);
  if (present.length > 0) {
    throw new AokitError(
      "INVALID_INPUT",
      `Module ${present.map((name) => `\`${name}\``).join(", ")} is already in this Project`,
      "use `aokit recopy` to re-render it, or `aokit remove` to drop it first",
    );
  }
}

function lockedAnswers(lockfile: Lockfile, name: string): Record<string, AnswerValue> {
  const values: Record<string, AnswerValue> = {};
  for (const [key, value] of Object.entries(lockfile.modules[name]?.answers ?? {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key] = value;
    }
  }
  return values;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function reproduceAdd(
  input: z.output<typeof addInput>,
  directory: string,
  answers: AnswerMap,
): string {
  const answerFlags = Object.entries(answers).flatMap(([module, values]) =>
    Object.entries(values).map(
      ([key, value]: [string, AnswerValue]) =>
        `--answer ${shellQuote(`${module}.${key}=${String(value)}`)}`,
    ),
  );
  return [
    "aokit add",
    ...input.modules.toSorted().map(shellQuote),
    ...(directory === "." ? [] : [`--directory ${shellQuote(directory)}`]),
    ...answerFlags.toSorted(),
    ...(input.install ? [] : ["--no-install"]),
    "--yes",
  ].join(" ");
}

async function renderNext(
  lockfile: Lockfile,
  input: z.output<typeof addInput>,
  directory: string,
  cliVersion: string,
  state: AddState,
): Promise<BuiltProject> {
  const lockedNames = Object.keys(lockfile.modules).toSorted();
  const registryName =
    lockfile.modules[lockedNames[0] ?? ""]?.registry ?? Object.keys(lockfile.registries)[0] ?? "";
  const registryEntry = lockfile.registries[registryName];
  if (registryEntry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const loaded = await loadRegistry(registrySource(registryEntry.source, directory), cliVersion);
  const { registry } = loaded;
  const catalog = registry.catalog(registryEntry.release);
  if (catalog === undefined) {
    throw new AokitError(
      "MODULE_VERSION_UNAVAILABLE",
      `Registry "${registryName}" does not hold the Catalog of Release ${registryEntry.release}.`,
      "Run `aokit recopy` to render with the Registry's current Release.",
    );
  }
  const locked = new Map<string, PipelineModule>();
  for (const name of lockedNames) {
    const entry = lockfile.modules[name];
    const found = entry === undefined ? undefined : registry.version(name, entry.version);
    if (entry === undefined || found === undefined) {
      throw new AokitError(
        "MODULE_VERSION_UNAVAILABLE",
        `Module ${name}@${entry?.version} is not available in Registry "${registryName}".`,
        `Run \`aokit recopy\` to render ${name} at the latest version the Registry offers.`,
      );
    }
    locked.set(name, {
      manifest: found.manifest,
      integrity: found.integrity,
      readFile: (from) => {
        const content = found.files.get(from);
        if (content === undefined) {
          throw new AokitError(
            "INTERNAL",
            `Module ${name} has no file ${from}`,
            "report the issue",
          );
        }
        return content;
      },
    });
  }
  const available = loaded.available.map((module) => locked.get(module.manifest.name) ?? module);
  const selection = [
    ...lockedNames.filter((name) => lockfile.modules[name]?.selected === true),
    ...input.modules,
  ];
  const resolved = resolveModules(
    { modules: selection, locked: lockedNames },
    available.map((module) => module.manifest),
    { acceptSuggestions: true },
  );
  if (!resolved.ok) throw fromResolveError(resolved.error);
  const fresh: ModuleManifest[] = resolved.modules
    .map((module) => module.manifest)
    .filter((manifest) => lockfile.modules[manifest.name] === undefined);
  const freshAnswers = completeAnswers(parseAnswers(input.answer, fresh), fresh);
  const answers: AnswerMap = Object.fromEntries(
    resolved.modules.map(({ manifest }) => [
      manifest.name,
      freshAnswers[manifest.name] ?? lockedAnswers(lockfile, manifest.name),
    ]),
  );
  const formatter = formatterForSelection({
    catalog,
    modules: resolved.modules.map((module) => module.manifest),
  });
  const built = await buildProject({
    selection,
    locked: lockedNames,
    available,
    answers,
    layout: lockfile.layout,
    catalog,
    context: { now: fixedNow, random: () => 0, env: {} },
    registry: {
      name: registryName,
      source: registryEntry.source,
      release: registryEntry.release,
      minCliVersion: registryEntry.minCliVersion,
    },
    acceptSuggestions: true,
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) throw fromResolveError(built.error);
  state.added = input.modules.toSorted();
  state.pulledIn = fresh
    .map((manifest) => manifest.name)
    .filter((name) => !input.modules.includes(name));
  state.answers = freshAnswers;
  state.next = built;
  return built;
}

export const addCommand = defineCommand({
  name: "add",
  description: "Add a Module to a Project",
  input: addInput,
  output: addOutput,
  async run(context, input) {
    const directory = resolvePath(input.directory);
    const state: AddState = { added: [], pulledIn: [], answers: {}, next: undefined };
    try {
      const result = await runLifecycle({
        dir: directory,
        driftOf,
        allowDirty: input.allowDirty,
        dryRun: input.dryRun,
        diff: input.diff,
        install: input.install,
        render: {
          base: async (lockfile) => {
            alreadySelected(lockfile, input.modules);
            return renderFromLockfile(lockfile, {
              projectDir: directory,
              bundledRegistryPath,
              cliVersion: context.version,
            });
          },
          next: (lockfile) => renderNext(lockfile, input, directory, context.version, state),
        },
      });
      const nextChanges = state.next?.plan.changes ?? [];
      const conflicts = result.conflicts.map((conflict) => ({
        path: conflict.path,
        provenance: provenanceOf(nextChanges, conflict.path),
      }));
      if (result.applied && conflicts.length > 0) {
        throw new AokitError(
          "MERGE_CONFLICTS",
          `${conflicts.length} file(s) have Conflicts: ${conflicts.map((conflict) => conflict.path).join(", ")}`,
          "resolve the markers (or the `.aokit-new` siblings), then run `aokit doctor`",
          { conflicts },
        );
      }
      return {
        directory,
        added: state.added,
        pulledIn: state.pulledIn,
        applied: result.applied,
        installed: result.installed,
        plan: {
          hash: result.plan.hash,
          changes: result.plan.changes.map((change) => ({
            type: change.type,
            path: change.path,
            mode: change.mode ?? null,
            ownership: change.ownership,
            provenance: provenanceOf(result.plan.changes, change.path),
          })),
        },
        conflicts,
        ...(result.diff === undefined ? {} : { diff: result.diff }),
        warnings: result.warnings,
        reproduce: reproduceAdd(input, input.directory, state.answers),
      };
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
