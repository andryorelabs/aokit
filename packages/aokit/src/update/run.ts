import { join, posix } from "node:path";
import { hashFileBytes, volatileHash } from "../drift/hash.ts";
import { layoutTables, type Target } from "../engine/layout.ts";
import type { Plan } from "../engine/plan.ts";
import type { Vfs } from "../engine/vfs.ts";
import type { ConflictWrite } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { keepProjectDeps, type KeptDependency } from "../lifecycle/keep-deps.ts";
import { applyAfterStage, loadUserTree, mergeVisibleEdits } from "../lifecycle/migration-stage.ts";
import { runLifecycle, type LifecycleResult } from "../lifecycle/index.ts";
import { readLockfile } from "../lockfile/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { composeRenames, type DriftOf } from "../merge/index.ts";
import { runMigrations, selectMigrations } from "../migrations/index.ts";
import { renderFromLockfile } from "../pipeline/index.ts";
import { fromResolveError } from "../project/errors.ts";
import { resolveRegistrySource } from "../project/registry.ts";
import { type LocalRegistry, readLocalRegistry } from "../registry/index.ts";
import { resolve as resolveModules } from "../resolver/resolve.ts";
import { resolveUpdateTarget, type UpdateTarget } from "./target.ts";

const bundledRegistry = join(import.meta.dir, "..", "..", "..", "..", "registry");
const migrationContext = { now: new Date(0), random: () => 0, env: {} };

/** Inputs of {@link runUpdate} and {@link buildUpdatePlan}. */
export interface UpdateInput {
  readonly dir: string;
  /** The Release to move to; the latest one the Registry lists when absent. */
  readonly to?: string;
  readonly allowDirty: boolean;
  /** Builds the Plan and writes nothing. */
  readonly dryRun: boolean;
  /** Returns the unified diff of the Plan; implies `dryRun`. */
  readonly diff: boolean;
  /** Applies without asking; without it a TTY is asked and anything else is `MISSING_VALUE`. */
  readonly yes: boolean;
  /** Runs `bun install` after a Plan that changed `package.json`. */
  readonly install: boolean;
  /** Version of the running CLI. */
  readonly cliVersion: string;
  /** Asks the user to confirm the Plan; absent when there is no one to ask. */
  readonly confirm?: (summary: string) => Promise<boolean>;
  readonly bundledRegistryPath?: string;
  readonly installer?: (directory: string) => Promise<void>;
}

/** One Migration an update ran. */
interface RanMigration {
  readonly module: string;
  readonly stage: "before" | "after";
  readonly from: string;
  readonly to: string;
  readonly script: string;
}

/** What {@link runUpdate} did. */
export interface UpdateResult {
  /** True when the Project already is on the target Release; nothing was written. */
  readonly upToDate: boolean;
  /** The Release the Lockfile records. */
  readonly fromRelease: string;
  /** The Release the update moves to. */
  readonly release: string;
  readonly plan: Plan | undefined;
  readonly conflicts: readonly ConflictWrite[];
  readonly warnings: readonly string[];
  readonly lockfile: Lockfile | undefined;
  readonly diff: string | undefined;
  readonly applied: boolean;
  readonly installed: boolean;
  /** True when Conflicts kept the stash and wrote the update marker. */
  readonly stashKept: boolean;
  readonly keptDeps: readonly KeptDependency[];
  readonly migrations: readonly RanMigration[];
}

interface UpdateModule {
  readonly name: string;
  readonly installed: string;
  readonly target: string;
}

interface UpdateState {
  keptDeps: KeptDependency[];
  migrations: RanMigration[];
  answers: Record<string, Record<string, unknown>>;
}

const driftOf: DriftOf = ({ entry, user }) => {
  if (entry === undefined) return user === undefined ? "deleted" : "unknown";
  if (entry.mode === "ejected") return "pristine";
  if (user === undefined) return "deleted";
  if (entry.hash === volatileHash) return "volatile";
  const bytes = typeof user === "string" ? new TextEncoder().encode(user) : user;
  return hashFileBytes(bytes) === entry.hash ? "pristine" : "modified";
};

async function readProjectLockfile(dir: string): Promise<Lockfile> {
  const parsed = await readLockfile(join(dir, "aokit.lock.json"));
  if (parsed === null) {
    throw new AokitError(
      "LOCKFILE_MISSING",
      `No aokit.lock.json found in "${dir}".`,
      "Run the command inside an aokit Project, or create one with `aokit create`.",
    );
  }
  return parsed.lockfile;
}

function registryNameOf(lockfile: Lockfile): string {
  const first = Object.keys(lockfile.modules).toSorted()[0];
  return lockfile.modules[first ?? ""]?.registry ?? Object.keys(lockfile.registries)[0] ?? "";
}

async function openRegistry(
  lockfile: Lockfile,
  input: UpdateInput,
  bundledRegistryPath: string,
): Promise<LocalRegistry> {
  const entry = lockfile.registries[registryNameOf(lockfile)];
  if (entry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const path = resolveRegistrySource(entry.source, {
    projectDir: input.dir,
    bundledRegistryPath,
  });
  return readLocalRegistry(path, { cliVersion: input.cliVersion });
}

/** Locked Modules in canonical Resolver order, with the version they move from and to. */
function modulesInOrder(
  lockfile: Lockfile,
  registry: LocalRegistry,
  target: UpdateTarget,
): UpdateModule[] {
  const names = Object.keys(lockfile.modules).toSorted();
  const manifests = names.flatMap((name) => {
    const version = target.versions[name];
    const found = version === undefined ? undefined : registry.version(name, version);
    return found === undefined ? [] : [found.manifest];
  });
  const resolved = resolveModules(
    {
      modules: names.filter((name) => lockfile.modules[name]?.selected === true),
      locked: names,
    },
    manifests,
    { acceptSuggestions: true },
  );
  if (!resolved.ok) throw fromResolveError(resolved.error);
  return resolved.modules.flatMap(({ manifest }) => {
    const installed = lockfile.modules[manifest.name]?.version;
    const goal = target.versions[manifest.name];
    return installed === undefined || goal === undefined
      ? []
      : [{ name: manifest.name, installed, target: goal }];
  });
}

function crossesMigration(registry: LocalRegistry, module: UpdateModule): boolean {
  const found = registry.version(module.name, module.target);
  return (
    found !== undefined &&
    selectMigrations(found.manifest, module.installed, module.target).length > 0
  );
}

function targetsOf(registry: LocalRegistry, module: UpdateModule): Target[] {
  const manifest = registry.version(module.name, module.target)?.manifest;
  return [...new Set(manifest?.files.map((file) => file.target) ?? [])];
}

/**
 * The Renames manifests of every version a Module crosses, composed in version order and resolved
 * against the Layout: a manifest path is relative to a Target the Module writes to.
 */
function resolvedRenames(
  lockfile: Lockfile,
  registry: LocalRegistry,
  modules: readonly UpdateModule[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const module of modules) {
    const crossed = registry
      .versions(module.name)
      .filter(
        (version) =>
          Bun.semver.order(version, module.installed) > 0 &&
          Bun.semver.order(version, module.target) <= 0,
      );
    const composed = composeRenames(
      crossed.map((version) => registry.version(module.name, version)?.renames ?? {}),
    );
    for (const target of targetsOf(registry, module)) {
      const directory = layoutTables[lockfile.layout][target];
      for (const [from, to] of composed) {
        const key = posix.join(directory, from);
        if (!resolved.has(key)) resolved.set(key, posix.join(directory, to));
      }
    }
  }
  return resolved;
}

function lockedAnswers(lockfile: Lockfile): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(lockfile.modules).map(([name, entry]) => [name, { ...entry.answers }]),
  );
}

function summaryOf(plan: Plan, release: string): string {
  const lines = plan.changes.map((change) => `  ${change.type} ${change.path}`);
  return [`Update to Release ${release}:`, ...lines].join("\n");
}

async function confirmPlan(input: UpdateInput, plan: Plan, release: string): Promise<void> {
  if (input.dryRun || input.diff || input.yes) return;
  if (input.confirm === undefined) {
    throw new AokitError(
      "MISSING_VALUE",
      "Updating needs a confirmation and there is no terminal to ask on.",
      "Pass `--yes` to apply the update, or `--dry-run` to only see the Plan.",
    );
  }
  if (!(await input.confirm(summaryOf(plan, release)))) {
    throw new AokitError("INTERRUPTED", "The update was not confirmed.", "Nothing was written.");
  }
}

interface Prepared {
  readonly target: UpdateTarget;
  readonly fromRelease: string;
  readonly run: ((dryRun: boolean) => Promise<LifecycleResult>) | undefined;
  readonly state: UpdateState;
}

async function prepare(input: UpdateInput): Promise<Prepared> {
  const bundledRegistryPath = input.bundledRegistryPath ?? bundledRegistry;
  const lockfile = await readProjectLockfile(input.dir);
  const registry = await openRegistry(lockfile, input, bundledRegistryPath);
  const target = resolveUpdateTarget(lockfile, registry, input.to);
  const fromRelease = lockfile.registries[registryNameOf(lockfile)]?.release ?? target.release;
  const state: UpdateState = { keptDeps: [], migrations: [], answers: lockedAnswers(lockfile) };
  if (target.upToDate) return { target, fromRelease, run: undefined, state };
  const modules = modulesInOrder(lockfile, registry, target);
  const hasMigrations = modules.some((module) => crossesMigration(registry, module));
  const trees: { original?: Vfs; edited?: Vfs } = {};
  const renderOptions = {
    projectDir: input.dir,
    bundledRegistryPath,
    cliVersion: input.cliVersion,
  };
  const run = (dryRun: boolean): Promise<LifecycleResult> =>
    runLifecycle({
      dir: input.dir,
      driftOf,
      allowDirty: input.allowDirty,
      dryRun,
      diff: input.diff,
      install: input.install,
      renames: resolvedRenames(lockfile, registry, modules),
      keepStashOnConflict: true,
      ...(input.installer === undefined ? {} : { installer: input.installer }),
      render: {
        base: (current) => renderFromLockfile(current, renderOptions),
        next: async (current, base) => {
          const rendered = await renderFromLockfile(current, {
            ...renderOptions,
            versionOverride: target.versions,
            release: target.release,
            answersOverride: state.answers,
          });
          if (base === undefined) return rendered;
          const kept = keepProjectDeps(current, base, rendered);
          state.keptDeps = kept.kept;
          return kept.next;
        },
      },
      beforeNext: async ({ lockfile: current }) => {
        if (!hasMigrations) return undefined;
        const original = await loadUserTree(input.dir);
        const edited = original.clone();
        const ran = await runMigrations({
          stage: "before",
          modules,
          vfs: edited,
          answers: lockedAnswers(current),
          context: migrationContext,
          registry,
        });
        state.answers = ran.answers;
        state.migrations.push(...ran.provenance);
        trees.original = original;
        trees.edited = edited;
        return mergeVisibleEdits(original, edited, current);
      },
      afterMerge: async (merged, { lockfile: current }) => {
        const { original, edited } = trees;
        const result =
          original === undefined || edited === undefined
            ? merged
            : await applyAfterStage({
                merged,
                lockfile: current,
                original,
                edited,
                run: async (vfs) => {
                  const ran = await runMigrations({
                    stage: "after",
                    modules,
                    vfs,
                    answers: state.answers,
                    context: migrationContext,
                    registry,
                  });
                  state.migrations.push(...ran.provenance);
                },
              });
        await confirmPlan(input, result.plan, target.release);
        return result;
      },
    });
  return { target, fromRelease, run, state };
}

function upToDateResult(prepared: Prepared): UpdateResult {
  return {
    upToDate: true,
    fromRelease: prepared.fromRelease,
    release: prepared.target.release,
    plan: undefined,
    conflicts: [],
    warnings: [],
    lockfile: undefined,
    diff: undefined,
    applied: false,
    installed: false,
    stashKept: false,
    keptDeps: [],
    migrations: [],
  };
}

function resultOf(prepared: Prepared, outcome: LifecycleResult): UpdateResult {
  return {
    upToDate: false,
    fromRelease: prepared.fromRelease,
    release: prepared.target.release,
    plan: outcome.plan,
    conflicts: outcome.conflicts,
    warnings: outcome.warnings,
    lockfile: outcome.lockfile,
    diff: outcome.diff,
    applied: outcome.applied,
    installed: outcome.installed,
    stashKept: outcome.stashKept,
    keptDeps: prepared.state.keptDeps,
    migrations: prepared.state.migrations,
  };
}

/**
 * Builds the update Plan without writing anything: target, base Render, `before` Migrations, target
 * Render, merge with renames, `after` Migrations. `update --plan` saves what this returns.
 */
export async function buildUpdatePlan(input: UpdateInput): Promise<UpdateResult> {
  const prepared = await prepare({ ...input, dryRun: true });
  if (prepared.run === undefined) return upToDateResult(prepared);
  return resultOf(prepared, await prepared.run(true));
}

/**
 * Updates the Project to the target Release: clean tree, target, base Render, `before` Migrations,
 * target Render, merge, `after` Migrations, Plan, confirmation, transactional apply, Lockfile and
 * install. Conflicts are returned, with the stash kept, so the command decides the exit code.
 * Nothing is written when the Project is up to date, or with `dryRun` or `diff`.
 */
export async function runUpdate(input: UpdateInput): Promise<UpdateResult> {
  const prepared = await prepare(input);
  if (prepared.run === undefined) return upToDateResult(prepared);
  return resultOf(prepared, await prepared.run(input.dryRun || input.diff));
}
