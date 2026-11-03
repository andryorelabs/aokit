import { posix } from "node:path";
import type { Catalog, ModuleManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  type Formatter,
  type OpHandler,
  Vfs,
  buildPlan,
  resolveTarget,
} from "../engine/index.ts";
import type { AnswerValue } from "../engine/interpolate.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { OpVfs } from "../engine/ops.ts";
import {
  type Plan,
  type Provenance,
  type ProvenanceEntry,
  diffVfs,
  hashVfs,
} from "../engine/plan.ts";
import { compareByCodepoint, normalizeProjectPath } from "../engine/vfs.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { serializeLockfile } from "../lockfile/serialize.ts";
import { applyDeps, applyEnv } from "../ops/data/index.ts";
import { resolve } from "../resolver/resolve.ts";
import type { ResolveError, ResolveWarning } from "../resolver/types.ts";
import { type AssembledModule, type RegistryInfo, assembleLockfile } from "./assemble.ts";

/** Inputs of {@link buildProject}. */
export interface PipelineInput {
  /** Names of the Modules the user picked. */
  readonly selection: readonly string[];
  /** Modules already recorded in a Lockfile. */
  readonly locked?: readonly string[];
  /** Every Module the Registry offers. */
  readonly available: readonly EngineModule[];
  readonly answers: Readonly<Record<string, Readonly<Record<string, AnswerValue>>>>;
  readonly layout: LayoutName;
  readonly catalog: Catalog;
  readonly context: EngineContext;
  readonly registry: RegistryInfo;
  readonly formatter?: Formatter;
  readonly acceptSuggestions?: boolean;
  readonly base?: Vfs;
  readonly opHandlers?: ReadonlyMap<string, OpHandler>;
}

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

function effectiveAnswers(
  manifest: ModuleManifest,
  given: Readonly<Record<string, AnswerValue>>,
): Record<string, AnswerValue> {
  const merged: Record<string, AnswerValue> = {};
  for (const [name, answer] of Object.entries(manifest.answers ?? {})) {
    const value = given[name] ?? answer.default;
    if (value !== undefined) {
      merged[name] = value;
    }
  }
  return merged;
}

function depsTarget(manifest: ModuleManifest, layout: LayoutName): string {
  if (layout === "single") {
    return "root";
  }
  const targets = [
    ...manifest.files.map((file) => file.target),
    ...manifest.ops.map((op) => op.target),
  ].filter((target) => target !== "root" && target !== "config");
  return targets.toSorted(compareByCodepoint)[0] ?? "root";
}

/**
 * Resolver, Engine (files, Ops, deps, env), Formatter, Plan and Lockfile assembly. Resolution
 * errors return before any VFS work. Nothing is written to disk.
 */
export async function buildProject(input: PipelineInput): Promise<BuiltProject | PipelineFailure> {
  const resolved = resolve(
    { modules: input.selection, ...(input.locked === undefined ? {} : { locked: input.locked }) },
    input.available.map((module) => module.manifest),
    { acceptSuggestions: input.acceptSuggestions === true },
  );
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, warnings: resolved.warnings };
  }
  const byName = new Map(input.available.map((module) => [module.manifest.name, module]));
  const modules = resolved.modules.flatMap((entry) => byName.get(entry.name) ?? []);
  const base = input.base ?? Vfs.empty();

  const built = await buildPlan({
    modules,
    layout: input.layout,
    answers: input.answers,
    context: input.context,
    base,
    ...(input.opHandlers === undefined ? {} : { opHandlers: input.opHandlers }),
  });

  const work = built.vfs.clone();
  const extra = new Map<string, Provenance[]>();
  const note = (path: string, module: string, entry: ProvenanceEntry): void => {
    extra.set(path, [...(extra.get(path) ?? []), { module, entry }]);
  };
  const deps: Lockfile["deps"] = {};
  const assembled: AssembledModule[] = [];
  const resolvePath = (target: string, relativePath: string): string =>
    normalizeProjectPath(posix.join(resolveTarget(input.layout, target), relativePath));

  for (const { manifest } of modules) {
    const opVfs: OpVfs = {
      has: (path) => work.has(path),
      paths: () => work.paths(),
      read: (path) => work.read(path),
      write: (path, content, options) => {
        work.write(path, content, options);
        note(normalizeProjectPath(path), manifest.name, { kind: "op", op: "deps" });
      },
    };
    const recorded = applyDeps({
      vfs: opVfs,
      layout: input.layout,
      module: manifest.name,
      target: depsTarget(manifest, input.layout),
      deps: manifest.deps,
      catalog: input.catalog,
      resolvePath,
    });
    for (const [name, entry] of Object.entries(recorded)) {
      deps[name] ??= entry;
    }
    applyEnv({ vfs: opVfs, env: manifest.env, resolvePath });
    assembled.push({
      manifest,
      answers: effectiveAnswers(manifest, input.answers[manifest.name] ?? {}),
    });
  }

  let finalVfs = work;
  if (input.formatter !== undefined) {
    finalVfs = await input.formatter.format(work.clone());
    for (const path of finalVfs.paths()) {
      if (work.read(path) !== finalVfs.read(path)) {
        note(path, input.formatter.name, { kind: "formatter" });
      }
    }
  }

  const original = new Map(built.changes.map((change) => [change.path, change.provenance]));
  const plan: Plan = {
    changes: diffVfs(base, finalVfs, (path) => [
      ...(original.get(path) ?? []),
      ...(extra.get(path) ?? []),
    ]),
    hash: hashVfs(finalVfs),
    vfs: finalVfs,
  };
  const lockfile = assembleLockfile({
    plan,
    modules: assembled,
    layout: input.layout,
    registry: input.registry,
    deps,
  });
  return {
    ok: true,
    plan,
    lockfile,
    lockfileText: serializeLockfile(lockfile),
    warnings: resolved.warnings,
  };
}
