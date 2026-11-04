import { join, posix } from "node:path";
import { apply } from "../apply/index.ts";
import { conflictFile } from "../apply/conflicts.ts";
import { openGit } from "../git/index.ts";
import { unifiedDiff } from "../project/diff.ts";
import { runInstall } from "../project/install.ts";
import {
  assertPlanFresh,
  deletePlanFile,
  fingerprintFiles,
  planMissingError,
  readPlanFile,
  writePlanFile,
} from "./plan-file.ts";
import { abortUpdate, planFilePath, writeUpdateMarker } from "./state.ts";
import { lockfileDriftOf } from "../drift/drift-of.ts";
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
import { composeRenames } from "../merge/index.ts";
import { runMigrations, selectMigrations } from "../migrations/index.ts";
import { renderFromLockfile } from "../pipeline/index.ts";
import { fromResolveError } from "../project/errors.ts";
import {
  openProjectRegistries,
  primaryRegistryName,
  type PinMove,
  type RegistryAdapters,
  snapshotRegistry,
} from "../project/registry.ts";
import { bundledRegistryPath as shippedRegistryPath } from "../registry/bundled.ts";
import type { LocalRegistry, Registry } from "../registry/index.ts";
import { resolve as resolveModules } from "../resolver/resolve.ts";
import { resolveUpdateTarget, type UpdateTarget } from "./target.ts";

const migrationContext = { now: new Date(0), random: () => 0, env: {} };

/** The Release every shadcn Registry reports: its items are versioned by content, not Release. */
const adaptedRelease = "shadcn";

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
  /**
   * `--registry <name|source>`: a `github:owner/repo#<ref>` of a Lockfile Registry moves its Pin to
   * the ref's commit; the only way a Pin moves.
   */
  readonly registry?: string;
  /** Every `--trust <name|source>` value. */
  readonly trustFlags?: readonly string[];
  /** Whether an untrusted Registry may be asked about; `false` by default. */
  readonly interactive?: boolean;
  /** How Registries are reached; the real network, cache and prompt by default. */
  readonly adapters?: RegistryAdapters;
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
  /** The `github:` Pins the update moves, with the source they move from and to. */
  readonly pins: readonly PinMove[];
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

/** Locked Modules in canonical Resolver order, with the version they move from and to. */
export function modulesInOrder(
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
  readonly pins: readonly PinMove[];
  readonly fromRelease: string;
  readonly run: ((dryRun: boolean) => Promise<LifecycleResult>) | undefined;
  readonly state: UpdateState;
}

/** The Lockfile with its `registries` entries replaced, as the update records them. */
function withRegistries(lockfile: Lockfile, registries: Lockfile["registries"]): Lockfile {
  return { ...lockfile, registries: { ...lockfile.registries, ...registries } };
}

/** The newest Release a Registry publishes, the one a plain update moves to. */
function newestRelease(registry: Registry): string {
  return (
    registry
      .releases()
      .toSorted((left, right) => Bun.semver.order(left, right))
      .at(-1) ?? registry.release
  );
}

/**
 * Every version of the primary Registry's locked Modules an update may cross or land on. For a
 * shadcn Registry that is the locked version and the item it serves now: their versions are
 * content hashes, not ordered.
 */
function upgradeScope(lockfile: Lockfile, key: string, registry: Registry): [string, string][] {
  const adapted = registry.source.kind === "shadcn" || registry.release === adaptedRelease;
  return Object.entries(lockfile.modules)
    .filter(([, entry]) => entry.registry === key)
    .flatMap(([name, entry]) =>
      (adapted
        ? [...new Set([entry.version, ...registry.selectableVersions(name)])]
        : registry.versions(name).filter((version) => Bun.semver.order(version, entry.version) >= 0)
      ).map((version): [string, string] => [name, version]),
    );
}

/** The snapshots of every shadcn Registry of the Lockfile besides `primaryKey`, named by key. */
async function adaptedSnapshots(
  lockfile: Lockfile,
  primaryKey: string,
  registries: ReadonlyMap<string, Registry>,
): Promise<LocalRegistry[]> {
  const adapted = Object.keys(lockfile.registries).flatMap((key) => {
    const registry = registries.get(key);
    return key === primaryKey || registry?.release !== adaptedRelease ? [] : [{ key, registry }];
  });
  return Promise.all(
    adapted.map(({ key, registry }) =>
      snapshotRegistry(registry, key, {
        versions: upgradeScope(lockfile, key, registry),
        releases: [adaptedRelease],
      }),
    ),
  );
}

/**
 * The primary Registry's target with each other shadcn Registry's Adapted Modules moved to the
 * item it serves now, so an added item's upstream change is an update too.
 */
function withAdaptedTargets(
  lockfile: Lockfile,
  primary: UpdateTarget,
  adapted: readonly LocalRegistry[],
): UpdateTarget {
  const versions = { ...primary.versions };
  let upToDate = primary.upToDate;
  for (const registry of adapted) {
    const own = resolveUpdateTarget(lockfile, registry);
    for (const [name, entry] of Object.entries(lockfile.modules)) {
      const served = own.versions[name];
      if (entry.registry !== registry.name || served === undefined) continue;
      versions[name] = served;
      upToDate &&= served === entry.version;
    }
  }
  return { ...primary, versions, upToDate };
}

/** One synchronous view of the primary snapshot and the shadcn ones, primary first. */
function combinedRegistry(
  primary: LocalRegistry,
  adapted: readonly LocalRegistry[],
): LocalRegistry {
  if (adapted.length === 0) return primary;
  const all = [primary, ...adapted];
  const owner = (name: string): LocalRegistry =>
    all.find((registry) => registry.versions(name).length > 0) ?? primary;
  return {
    ...primary,
    version: (name, version) =>
      all.map((registry) => registry.version(name, version)).find((found) => found !== undefined),
    versions: (name) => owner(name).versions(name),
    selectableVersions: (name) => owner(name).selectableVersions(name),
  };
}

async function prepare(input: UpdateInput): Promise<Prepared> {
  const bundledRegistryPath = input.bundledRegistryPath ?? shippedRegistryPath;
  const lockfile = await readProjectLockfile(input.dir);
  const set = await openProjectRegistries(lockfile, {
    registryFlag: input.registry,
    allowPinMove: true,
    trustFlags: input.trustFlags ?? [],
    interactive: input.interactive ?? false,
    projectDir: input.dir,
    cliVersion: input.cliVersion,
    bundledRegistryPath,
    adapters: input.adapters,
  });
  const key = primaryRegistryName(lockfile);
  const primary = set.registries.get(key);
  if (primary === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const [primarySnapshot, adapted] = await Promise.all([
    snapshotRegistry(primary, key, {
      versions: upgradeScope(lockfile, key, primary),
      releases: [
        ...new Set([
          lockfile.registries[key]?.release ?? primary.release,
          input.to ?? newestRelease(primary),
        ]),
      ],
    }),
    adaptedSnapshots(lockfile, key, set.registries),
  ]);
  const pins = set.movedPins;
  const resolved = withAdaptedTargets(
    lockfile,
    resolveUpdateTarget(lockfile, primarySnapshot, input.to),
    adapted,
  );
  const registry = combinedRegistry(primarySnapshot, adapted);
  const target = pins.length > 0 ? { ...resolved, upToDate: false } : resolved;
  const fromRelease = lockfile.registries[key]?.release ?? target.release;
  const state: UpdateState = { keptDeps: [], migrations: [], answers: lockedAnswers(lockfile) };
  if (target.upToDate) return { target, pins, fromRelease, run: undefined, state };
  const modules = modulesInOrder(lockfile, registry, target);
  const hasMigrations = modules.some((module) => crossesMigration(registry, module));
  const trees: { original?: Vfs; edited?: Vfs } = {};
  const renderOptions = {
    projectDir: input.dir,
    bundledRegistryPath,
    cliVersion: input.cliVersion,
  };
  const recorded = (current: Lockfile): Lockfile => withRegistries(current, set.entries);
  const run = (dryRun: boolean): Promise<LifecycleResult> =>
    runLifecycle({
      dir: input.dir,
      driftOf: lockfileDriftOf,
      allowDirty: input.allowDirty,
      dryRun,
      diff: input.diff,
      install: input.install,
      renames: resolvedRenames(lockfile, registry, modules),
      keepStashOnConflict: true,
      ...(input.installer === undefined ? {} : { installer: input.installer }),
      render: {
        base: (current) =>
          renderFromLockfile(current, { ...renderOptions, registries: set.lockedRegistries }),
        next: async (current, base) => {
          const rendered = await renderFromLockfile(recorded(current), {
            ...renderOptions,
            registries: set.registries,
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
  return { target, pins, fromRelease, run, state };
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
    pins: [],
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
    pins: prepared.pins,
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

const lockfileFileName = "aokit.lock.json";

/** What {@link planUpdate} saved. */
export interface PlannedUpdate {
  readonly result: UpdateResult;
  /** Absolute path of the saved Plan; `undefined` when the Project is up to date. */
  readonly planPath: string | undefined;
}

/**
 * Builds the update Plan and saves it to `<git-dir>/aokit/plan.json` (`.aokit/plan.json` outside
 * git) with the hashes of the Lockfile and every user file it depends on. The Project is unchanged.
 */
export async function planUpdate(input: UpdateInput): Promise<PlannedUpdate> {
  const lockfile = await readProjectLockfile(input.dir);
  const result = await buildUpdatePlan(input);
  if (result.upToDate || result.plan === undefined || result.lockfile === undefined) {
    return { result, planPath: undefined };
  }
  const git = (await openGit(input.dir)) ?? undefined;
  const hashes = await fingerprintFiles(input.dir, [
    lockfileFileName,
    ...Object.keys(lockfile.files),
  ]);
  const { [lockfileFileName]: lockfileHash, ...userFileHashes } = hashes;
  await writePlanFile(input.dir, git, {
    cliVersion: input.cliVersion,
    targetRelease: result.release,
    lockfileHash: lockfileHash ?? null,
    userFileHashes,
    plan: result.plan,
    conflicts: result.conflicts,
    targetLockfile: result.lockfile,
    keptDeps: result.keptDeps,
    migrations: result.migrations,
  });
  return { result, planPath: await planFilePath(input.dir, git) };
}

function changesPackageJson(plan: NonNullable<UpdateResult["plan"]>): boolean {
  return plan.changes.some(
    (change) =>
      (change.path === "package.json" || change.path.endsWith("/package.json")) &&
      change.type !== "delete",
  );
}

/** The `github:` sources that differ between the Lockfile on disk and the saved target one. */
function movedPins(before: Lockfile, after: Lockfile): PinMove[] {
  return Object.entries(after.registries).flatMap(([registry, entry]) => {
    const from = before.registries[registry]?.source;
    return from !== undefined && from !== entry.source && entry.source.startsWith("github:")
      ? [{ registry, from, to: entry.source }]
      : [];
  });
}

/**
 * Applies exactly the saved Plan: `PLAN_MISSING` without one, `PLAN_STALE` when the Lockfile or a
 * recorded user file changed. Conflicts keep the stash and write the update marker; a successful
 * apply deletes the saved Plan.
 */
export async function applyUpdatePlan(input: UpdateInput): Promise<UpdateResult> {
  const git = (await openGit(input.dir)) ?? undefined;
  const saved = await readPlanFile(input.dir, git);
  if (saved === null) throw planMissingError();
  await assertPlanFresh(input.dir, saved);
  const lockfile = await readProjectLockfile(input.dir);
  const fromRelease =
    lockfile.registries[primaryRegistryName(lockfile)]?.release ?? saved.targetRelease;
  const base = {
    upToDate: false,
    fromRelease,
    release: saved.targetRelease,
    plan: saved.plan,
    conflicts: saved.conflicts,
    warnings: [],
    lockfile: saved.targetLockfile,
    keptDeps: saved.keptDeps ?? [],
    migrations: saved.migrations ?? [],
    pins: movedPins(lockfile, saved.targetLockfile),
  } satisfies Partial<UpdateResult>;
  if (input.dryRun || input.diff) {
    return {
      ...base,
      diff: unifiedDiff(saved.plan),
      applied: false,
      installed: false,
      stashKept: false,
    };
  }
  await confirmPlan(input, saved.plan, saved.targetRelease);
  const keepStash = saved.conflicts.length > 0;
  const previousLockfile = keepStash
    ? await Bun.file(join(input.dir, lockfileFileName)).text()
    : "";
  const applied = await apply(saved.plan, saved.targetLockfile, input.dir, {
    ...(git === undefined ? {} : { git }),
    conflicts: saved.conflicts,
    keepStash,
  });
  if (keepStash && applied.stash !== undefined) {
    await writeUpdateMarker(input.dir, git, {
      stashDirectory: applied.stash.directory,
      conflictedPaths: saved.conflicts.map((conflict) => conflict.path),
      newSiblingPaths: saved.conflicts
        .filter((conflict) => conflict.merged === undefined)
        .map(conflictFile),
      createdPaths: [...applied.stash.created],
      previousLockfile,
    });
  }
  await deletePlanFile(input.dir, git);
  const shouldInstall = input.install && changesPackageJson(saved.plan);
  if (shouldInstall) await (input.installer ?? ((dir) => runInstall(dir, process.env)))(input.dir);
  return {
    ...base,
    diff: undefined,
    applied: true,
    installed: shouldInstall,
    stashKept: keepStash,
  };
}

/** Undoes a conflicted update and drops a saved Plan; `null` when there was nothing to abort. */
export async function abortProjectUpdate(dir: string): Promise<{ restored: string[] } | null> {
  return abortUpdate(dir, (await openGit(dir)) ?? undefined);
}
