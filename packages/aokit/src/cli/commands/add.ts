import { resolve as resolvePath } from "node:path";
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
import {
  assertCatalogDepsAuthenticated,
  openProjectRegistries,
  openShadcnAddresses,
  primaryRegistryName,
  type ProjectRegistries,
  type RegistryAdapters,
  resolutionOrder,
  toPipelineModule,
} from "../../project/registry.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import type { Registry } from "../../registry/index.ts";
import { resolve as resolveModules } from "../../resolver/resolve.ts";
import { isNonInteractive } from "../../trust/gate.ts";
import { type CommandContext, defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

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
  registry: z
    .string()
    .optional()
    .describe("Registry to look the added Modules up in first, by Lockfile name or source")
    .register(aokitMeta, {
      flag: "registry",
      examples: ["--registry https://registry.example.com", "--registry github:acme/mods#v1"],
    }),
  trust: z
    .array(z.string())
    .default([])
    .describe("Trust a Registry by name or source; repeatable. `--yes` never grants trust")
    .register(aokitMeta, { flag: "trust", examples: ["--trust github:acme/mods"] }),
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

const fetchedOutput = z.array(
  z.object({
    module: z.string(),
    version: z.string(),
    registry: z.string(),
    source: z.string(),
    integrity: z.string(),
  }),
);

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
  fetched: fetchedOutput,
  diff: z.string().optional(),
  warnings: z.array(z.string()),
  reproduce: z.string(),
});

type Provenance = z.infer<typeof provenanceOutput>;
type Fetched = z.infer<typeof fetchedOutput>;
type AddInput = z.output<typeof addInput>;
type AddOutput = z.output<typeof addOutput>;

/** What the next Render decided; filled while the lifecycle runs. */
interface AddState {
  added: string[];
  pulledIn: string[];
  answers: AnswerMap;
  next: BuiltProject | undefined;
  fetched: Fetched;
}

/** How `add` reads Registries. */
interface AddEnvironment {
  readonly cliVersion: string;
  readonly interactive: boolean;
  readonly adapters: RegistryAdapters;
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

function reproduceAdd(input: AddInput, directory: string, answers: AnswerMap): string {
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
    ...(input.registry === undefined ? [] : [`--registry ${shellQuote(input.registry)}`]),
    ...input.trust.map((value) => `--trust ${shellQuote(value)}`),
    ...answerFlags.toSorted(),
    ...(input.install ? [] : ["--no-install"]),
    "--yes",
  ].join(" ");
}

function isRemote(registry: Registry | undefined): boolean {
  return (
    registry?.source.kind === "url" ||
    registry?.source.kind === "github" ||
    registry?.source.kind === "shadcn"
  );
}

function unavailable(name: string, version: string | undefined, registry: string): AokitError {
  return new AokitError(
    "MODULE_VERSION_UNAVAILABLE",
    `Module ${name}@${version} is not available in Registry "${registry}".`,
    `Run \`aokit recopy\` to render ${name} at the latest version the Registry offers.`,
  );
}

/** Every locked Module at its locked version, read from the Registry the Lockfile records. */
async function lockedModules(
  lockfile: Lockfile,
  set: ProjectRegistries,
): Promise<PipelineModule[]> {
  return Promise.all(
    Object.keys(lockfile.modules)
      .toSorted()
      .map(async (name) => {
        const entry = lockfile.modules[name];
        const registry = set.registries.get(entry?.registry ?? "");
        if (entry === undefined || registry === undefined) {
          throw unavailable(name, entry?.version, entry?.registry ?? "");
        }
        if (!registry.versions(name).includes(entry.version)) {
          throw unavailable(name, entry.version, entry.registry);
        }
        return toPipelineModule(await registry.version(name, entry.version), entry.registry);
      }),
  );
}

/** The Registry key each requested, not yet locked Module is taken from: the first that has it. */
function requestedPicks(
  lockfile: Lockfile,
  set: ProjectRegistries,
  requested: readonly string[],
): Map<string, string> {
  const order = resolutionOrder(set);
  const picks = new Map<string, string>();
  for (const name of requested) {
    if (lockfile.modules[name] !== undefined) continue;
    const key = order.find(
      (candidate) => (set.registries.get(candidate)?.selectableVersions(name).length ?? 0) > 0,
    );
    if (key !== undefined) picks.set(name, key);
  }
  return picks;
}

function newestOf(
  set: ProjectRegistries,
  name: string,
  key: string,
): Promise<PipelineModule> | undefined {
  const registry = set.registries.get(key);
  const newest = registry?.selectableVersions(name).at(-1);
  return registry === undefined || newest === undefined
    ? undefined
    : registry.version(name, newest).then((version) => toPipelineModule(version, key));
}

/** The capability a `requires` entry names, without an extension point's version range. */
function requiredCapability(requirement: string): string {
  return requirement.split("@")[0] ?? requirement;
}

/**
 * The Modules of a remote Registry that provide what the offered remote Modules require and no
 * offered or locked Module provides, read until every such requirement is met or no Module of that
 * Registry provides it; the Resolver reports whatever is still missing.
 */
async function remoteProviders(
  lockfile: Lockfile,
  set: ProjectRegistries,
  known: readonly PipelineModule[],
): Promise<PipelineModule[]> {
  const found: PipelineModule[] = [];
  let pending = known.filter((module) => isRemote(set.registries.get(module.registry ?? "")));
  while (pending.length > 0) {
    const everything = [...known, ...found];
    const offered = new Set(everything.map((module) => module.manifest.name));
    const provided = new Set(
      everything.flatMap((module) => module.manifest.provides.map((entry) => entry.capability)),
    );
    const wanted = new Map<string, string>();
    for (const module of pending) {
      const key = module.registry ?? "";
      const registry = set.registries.get(key);
      for (const requirement of module.manifest.requires) {
        const capability = requiredCapability(requirement);
        if (registry === undefined || provided.has(capability)) continue;
        const provider = Object.keys(registry.index.modules)
          .toSorted()
          .find((name) => {
            const newest = registry.selectableVersions(name).at(-1);
            const entry =
              newest === undefined ? undefined : registry.index.modules[name]?.versions[newest];
            return (
              !offered.has(name) &&
              lockfile.modules[name] === undefined &&
              entry?.provides.includes(capability) === true
            );
          });
        if (provider !== undefined) wanted.set(provider, key);
      }
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- each round reads what the last one requires
    pending = await Promise.all(
      [...wanted].flatMap(([name, key]) => newestOf(set, name, key) ?? []),
    );
    found.push(...pending);
  }
  return found;
}

/**
 * The Modules `add` offers besides the locked ones, at their newest selectable version. A
 * requested Module comes from the first Registry in resolution order that publishes it; any other
 * Module from the first first-party Registry that has it. A remote Registry is read only for the
 * Modules the user named and the ones of that Registry that provide what they require.
 */
async function offeredModules(
  lockfile: Lockfile,
  set: ProjectRegistries,
  requested: readonly string[],
  locked: readonly PipelineModule[],
): Promise<PipelineModule[]> {
  const picks = requestedPicks(lockfile, set, requested);
  const chosen = new Map<string, string>(picks);
  for (const key of resolutionOrder(set)) {
    const registry = set.registries.get(key);
    if (registry === undefined || isRemote(registry)) continue;
    for (const name of Object.keys(registry.index.modules)) {
      if (!chosen.has(name) && lockfile.modules[name] === undefined) chosen.set(name, key);
    }
  }
  const offered = await Promise.all(
    [...chosen]
      .toSorted(([left], [right]) => (left < right ? -1 : 1))
      .flatMap(([name, key]) => newestOf(set, name, key) ?? []),
  );
  return [...offered, ...(await remoteProviders(lockfile, set, [...locked, ...offered]))];
}

/** The Modules this run reads from a Registry that is not first-party, for the Plan. */
function fetchedFrom(built: BuiltProject, lockfile: Lockfile, set: ProjectRegistries): Fetched {
  return Object.entries(built.lockfile.modules)
    .filter(
      ([name, entry]) =>
        lockfile.modules[name] === undefined && isRemote(set.registries.get(entry.registry)),
    )
    .map(([name, entry]) => ({
      module: name,
      version: entry.version,
      registry: entry.registry,
      source: built.lockfile.registries[entry.registry]?.source ?? "",
      integrity: entry.integrity,
    }))
    .toSorted((left, right) => (left.module < right.module ? -1 : 1));
}

async function renderNext(
  lockfile: Lockfile,
  input: AddInput,
  directory: string,
  environment: AddEnvironment,
  state: AddState,
): Promise<BuiltProject> {
  const registryName = primaryRegistryName(lockfile);
  const registryEntry = lockfile.registries[registryName];
  if (registryEntry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const registryOptions = {
    registryFlag: input.registry,
    trustFlags: input.trust,
    interactive: environment.interactive,
    projectDir: directory,
    cliVersion: environment.cliVersion,
    bundledRegistryPath,
    adapters: environment.adapters,
  };
  const addressed = await openShadcnAddresses(
    await openProjectRegistries(lockfile, registryOptions),
    lockfile,
    input.modules,
    registryOptions,
  );
  const { set, names: requested } = addressed;
  alreadySelected(lockfile, requested);
  const catalog = await set.registries.get(registryName)?.catalog(registryEntry.release);
  if (catalog === undefined) {
    throw new AokitError(
      "MODULE_VERSION_UNAVAILABLE",
      `Registry "${registryName}" does not hold the Catalog of Release ${registryEntry.release}.`,
      "Run `aokit recopy` to render with the Registry's current Release.",
    );
  }
  const lockedNames = Object.keys(lockfile.modules).toSorted();
  const locked = await lockedModules(lockfile, set);
  const offered = await offeredModules(lockfile, set, requested, locked);
  const offeredNames = new Set(offered.map((module) => module.manifest.name));
  const dependencies = addressed.modules
    .filter(({ version }) => !offeredNames.has(version.name))
    .map(({ key, version }) => toPipelineModule(version, key));
  const available = [...locked, ...offered, ...dependencies];
  const selection = [
    ...lockedNames.filter((name) => lockfile.modules[name]?.selected === true),
    ...requested,
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
    registries: set.entries,
    acceptSuggestions: true,
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) throw fromResolveError(built.error);
  assertCatalogDepsAuthenticated(set.registries.get(registryName), lockfile, built.lockfile);
  state.added = requested.toSorted();
  state.pulledIn = fresh
    .map((manifest) => manifest.name)
    .filter((name) => !requested.includes(name));
  state.answers = freshAnswers;
  state.next = built;
  state.fetched = fetchedFrom(built, lockfile, set);
  return built;
}

/**
 * Runs `add`: reads the Project's Registries and the `--registry` one through the Registry client,
 * the cache and the trust gate, renders the next Project and applies it. `adapters` reach the
 * Registries; the real network, cache and prompt by default.
 */
export async function runAdd(
  context: Pick<CommandContext, "version" | "env">,
  input: AddInput,
  adapters: RegistryAdapters = {},
): Promise<AddOutput> {
  const directory = resolvePath(input.directory);
  const state: AddState = { added: [], pulledIn: [], answers: {}, next: undefined, fetched: [] };
  const environment: AddEnvironment = {
    cliVersion: context.version,
    interactive: !isNonInteractive({
      yes: input.yes,
      env: context.env,
      isTTY: process.stdin.isTTY,
    }),
    adapters: { env: context.env, ...adapters },
  };
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
            trustFlags: input.trust,
            adapters: environment.adapters,
          });
        },
        next: (lockfile) => renderNext(lockfile, input, directory, environment, state),
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
      fetched: state.fetched,
      ...(result.diff === undefined ? {} : { diff: result.diff }),
      warnings: result.warnings,
      reproduce: reproduceAdd(input, input.directory, state.answers),
    };
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}

export const addCommand = defineCommand({
  name: "add",
  description: "Add a Module to a Project",
  input: addInput,
  output: addOutput,
  run: (context, input) => runAdd(context, input),
});
