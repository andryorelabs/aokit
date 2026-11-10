import { type Catalog, stableStringify } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  type Formatter,
  type OpHandler,
  Vfs,
  buildPlan,
} from "../engine/index.ts";
import type { AnswerValue } from "../engine/interpolate.ts";
import { effectiveAnswers } from "../project/answers.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { Plan } from "../engine/plan.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { serializeLockfile } from "../lockfile/serialize.ts";
import { computeIntegrity } from "../registry/integrity.ts";
import { resolve } from "../resolver/resolve.ts";
import type { ResolveError, ResolveIntent, ResolveWarning } from "../resolver/types.ts";
import { type AssembledModule, type RegistryInfo, assembleLockfile } from "./assemble.ts";

/**
 * A Module the Registry offers. `integrity` is the value its index published for this version;
 * when absent (in-memory fixtures) it falls back to a digest of the canonical manifest.
 */
export interface PipelineModule extends EngineModule {
  readonly integrity?: string;
  /** The key of the Registry the Module comes from; `registry.name` of the build when absent. */
  readonly registry?: string;
}

interface PipelineInputBase {
  /** Names of the Modules the user picked. */
  readonly selection: readonly string[];
  /** Modules already recorded in a Lockfile. */
  readonly locked?: readonly string[];
  /** Every Module the Registry offers. */
  readonly available: readonly PipelineModule[];
  readonly answers: Readonly<Record<string, Readonly<Record<string, AnswerValue>>>>;
  readonly layout: LayoutName;
  readonly catalog: Catalog;
  readonly context: EngineContext;
  readonly registry: RegistryInfo;
  /**
   * Every other Registry the Lockfile records, by key; kept when a Module still comes from it. The
   * entry of `registry.name` supplies its `trusted` flag.
   */
  readonly registries?: Lockfile["registries"];
  /** Runs on the files this build renders only, never on files that came from `base`. */
  readonly formatter?: Formatter;
  readonly acceptSuggestions?: boolean;
  /** Which command's wording the Resolver uses in its fix lines; defaults to `add`. */
  readonly intent?: ResolveIntent;
  readonly opHandlers?: ReadonlyMap<string, OpHandler>;
}

/**
 * Inputs of {@link buildProject}. A build over a `base` always names the Lockfile it starts from;
 * without a `base` the build is a fresh Render from an empty tree.
 */
export type PipelineInput = PipelineInputBase &
  (
    | {
        /** The tree the Plan is diffed against. */
        readonly base: Vfs;
        /** The Lockfile already on disk; its file owners carry over for unchanged files. */
        readonly previous: Lockfile;
      }
    | {
        readonly base?: undefined;
        readonly previous?: Lockfile;
      }
  );

/** A built Project, ready to apply. */
export interface BuiltProject {
  readonly ok: true;
  readonly plan: Plan;
  readonly lockfile: Lockfile;
  /** Byte-exact text of `aokit.lock.json`. */
  readonly lockfileText: string;
  readonly warnings: readonly ResolveWarning[];
}

/** Resolution failed; nothing was built. */
export interface PipelineFailure {
  readonly ok: false;
  readonly error: ResolveError;
  readonly warnings: readonly ResolveWarning[];
}

/**
 * Resolver, Engine (files, Ops, deps, env, Formatter, Plan) and Lockfile assembly. Resolution
 * errors return before any VFS work. A non-empty `base` without `previous` throws. Nothing is
 * written to disk.
 */
export async function buildProject(input: PipelineInput): Promise<BuiltProject | PipelineFailure> {
  const base = input.base ?? Vfs.empty();
  if (base.paths().length > 0 && input.previous === undefined) {
    throw new TypeError(
      "buildProject received a non-empty `base` without the `previous` Lockfile it was read with.",
    );
  }
  const resolved = resolve(
    { modules: input.selection, ...(input.locked === undefined ? {} : { locked: input.locked }) },
    input.available.map((module) => module.manifest),
    {
      acceptSuggestions: input.acceptSuggestions === true,
      ...(input.intent === undefined ? {} : { intent: input.intent }),
    },
  );
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, warnings: resolved.warnings };
  }
  const byName = new Map(input.available.map((module) => [module.manifest.name, module]));
  const modules = resolved.modules.flatMap((entry) => byName.get(entry.name) ?? []);

  const built = await buildPlan({
    modules,
    layout: input.layout,
    answers: input.answers,
    context: input.context,
    catalog: input.catalog,
    base,
    ...(input.formatter === undefined ? {} : { formatter: input.formatter }),
    ...(input.opHandlers === undefined ? {} : { opHandlers: input.opHandlers }),
  });

  const selected = new Set(input.selection);
  const assembled: AssembledModule[] = modules.map(({ manifest, integrity, registry }) => ({
    manifest,
    registry,
    answers: effectiveAnswers(manifest, input.answers[manifest.name] ?? {}),
    integrity: integrity ?? computeIntegrity(stableStringify(manifest)),
    selected: selected.has(manifest.name),
  }));
  const plan: Plan = { changes: built.changes, hash: built.hash, vfs: built.vfs };
  const lockfile = assembleLockfile({
    plan,
    modules: assembled,
    layout: input.layout,
    registry: input.registry,
    ...(input.registries === undefined ? {} : { registries: input.registries }),
    deps: built.deps,
    ...(input.previous === undefined ? {} : { previousFiles: input.previous.files }),
  });
  return {
    ok: true,
    plan,
    lockfile,
    lockfileText: serializeLockfile(lockfile),
    warnings: resolved.warnings,
  };
}
