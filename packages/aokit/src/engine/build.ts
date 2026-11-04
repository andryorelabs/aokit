import { posix } from "node:path";
import type { Catalog, ModuleManifest } from "@aokit/module";
import { codeOpHandlers } from "../ops/code/index.ts";
import { applyDeps, applyEnv, dataOpHandlers, wireWorkspaces } from "../ops/data/index.ts";
import { coreOwner, writeAgentFiles } from "./agent-files.ts";
import { EngineError } from "./errors.ts";
import {
  type AnswerValue,
  interpolateContent,
  interpolatePath,
  interpolateImports,
  interpolateTargets,
  interpolateTargetsDeep,
} from "./interpolate.ts";
import { type LayoutName, resolveTarget } from "./layout.ts";
import {
  type DeclaredExtensionPoint,
  type EngineContext,
  type EngineModule,
  type OpHandler,
  type OpVfs,
  createOpRegistry,
} from "./ops.ts";
import {
  type Formatter,
  type Plan,
  type Provenance,
  type ProvenanceEntry,
  diffVfs,
  hashVfs,
} from "./plan.ts";
import {
  type FileContent,
  type Ownership,
  Vfs,
  compareByCodepoint,
  normalizeProjectPath,
} from "./vfs.ts";

/** A path the caller wants removed from the working tree, e.g. a file of a Module being removed. */
interface Removal {
  readonly path: string;
  readonly module: string;
}

/** Inputs of {@link buildPlan}. */
export interface BuildPlanOptions {
  /** Selected Modules in canonical order. */
  readonly modules: readonly EngineModule[];
  readonly layout: LayoutName;
  /** Answers keyed by Module name; a Module only sees the variables it declares. */
  readonly answers: Readonly<Record<string, Readonly<Record<string, AnswerValue>>>>;
  readonly context: EngineContext;
  /** The Release Catalog that resolves `catalog` dependency ranges; defaults to an empty one. */
  readonly catalog?: Catalog;
  /** The tree the Plan is diffed against; defaults to an empty tree. */
  readonly base?: Vfs;
  /** Runs on the files this build wrote only; files that come from `base` untouched are never formatted. */
  readonly formatter?: Formatter;
  readonly removals?: readonly Removal[];
  /** Op handlers by name; defaults to the built-in code and data registries. */
  readonly opHandlers?: ReadonlyMap<string, OpHandler>;
}

/** A dependency a Plan adds to a `package.json`, with the Modules that declare it. */
interface PlanDependency {
  readonly version: string;
  readonly pinned: boolean;
  readonly source: "catalog" | "module";
  /** Names of the Modules whose manifests list the dependency, sorted. */
  readonly owners: string[];
}

/** A {@link Plan} together with the dependencies its Modules declared. */
export interface BuiltPlan extends Plan {
  readonly deps: Readonly<Record<string, PlanDependency>>;
}

interface Producer {
  readonly module: string;
  readonly overrides: boolean;
}

const defaultOpHandlers = createOpRegistry(codeOpHandlers, dataOpHandlers);

function targetWriters(modules: readonly EngineModule[]): Map<string, string[]> {
  const writers = new Map<string, Set<string>>();
  const note = (target: string, module: string): void => {
    writers.set(target, (writers.get(target) ?? new Set<string>()).add(module));
  };
  for (const { manifest } of modules) {
    for (const file of manifest.files) {
      note(file.target, manifest.name);
    }
    for (const op of manifest.ops) {
      if ("target" in op) {
        note(op.target, manifest.name);
      }
    }
    for (const point of manifest.extensionPoints) {
      note(point.target, manifest.name);
    }
  }
  return new Map(
    [...writers].map(([target, names]) => [target, [...names].toSorted(compareByCodepoint)]),
  );
}

function assertOpsKnown(
  modules: readonly EngineModule[],
  handlers: ReadonlyMap<string, OpHandler>,
): void {
  for (const { manifest } of modules) {
    for (const op of manifest.ops) {
      if (!handlers.has(op.op)) {
        throw new EngineError(
          "engine.unknown-op",
          `Unknown Op "${op.op}" in Module "${manifest.name}". No handler is registered for it.`,
          [manifest.name],
        );
      }
    }
  }
}

const emptyCatalog: Catalog = { dependencies: {}, pinGroups: {} };

function depsTarget(manifest: ModuleManifest, layout: LayoutName): string {
  if (layout === "single") {
    return "root";
  }
  const targets = [
    ...manifest.files.map((file) => file.target),
    ...manifest.ops.flatMap((op) => ("target" in op ? [op.target] : [])),
  ].filter((target) => target !== "root" && target !== "config");
  return targets.toSorted(compareByCodepoint)[0] ?? "root";
}

function sameContent(left: FileContent | undefined, right: FileContent | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function joinTargetPath(directory: string, relativePath: string): string {
  return normalizeProjectPath(posix.join(directory, relativePath));
}

function defaultAnswers(
  manifest: EngineModule["manifest"],
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

class ProvenanceLog {
  private readonly byPath = new Map<string, Provenance[]>();

  set(path: string, provenance: Provenance[]): void {
    this.byPath.set(path, provenance);
  }

  add(path: string, module: string, entry: ProvenanceEntry): void {
    const list = this.byPath.get(path) ?? [];
    const serialized = JSON.stringify(entry);
    if (!list.some((p) => p.module === module && JSON.stringify(p.entry) === serialized)) {
      list.push({ module, entry });
    }
    this.byPath.set(path, list);
  }

  addOverridden(path: string, module: string, entry: ProvenanceEntry): void {
    const list = this.byPath.get(path) ?? [];
    if (!list.some((p) => p.module === module && p.overridden === true)) {
      list.push({ module, entry, overridden: true });
    }
    this.byPath.set(path, list);
  }

  get(path: string): readonly Provenance[] {
    return this.byPath.get(path) ?? [];
  }
}

function opOverrideKeys(manifest: ModuleManifest): ReadonlySet<string> {
  return new Set(manifest.override.flatMap((entry) => ("op" in entry ? [entry.op] : [])));
}

function opKeysOf(op: ModuleManifest["ops"][number]): string[] {
  const location = "extensionPoint" in op ? op.extensionPoint : "file" in op ? op.file : "";
  return [op.op, `${op.op}:${"target" in op ? (op.target ?? "") : ""}:${location ?? ""}`];
}

function opKeysOverlap(first: string, second: string): boolean {
  if (first === second) {
    return true;
  }
  const firstOp = first.split(":")[0];
  const secondOp = second.split(":")[0];
  return firstOp === secondOp && (!first.includes(":") || !second.includes(":"));
}

/**
 * Maps every overridden Op key to the single Module that overrides it. Two overriders fail, and
 * a bare Op name overlaps every qualified `op:target:location` key of the same Op.
 */
function opOverriders(modules: readonly EngineModule[]): Map<string, string> {
  const overriders = new Map<string, string>();
  for (const { manifest } of modules) {
    for (const key of opOverrideKeys(manifest)) {
      for (const [existingKey, existing] of overriders) {
        if (existing !== manifest.name && opKeysOverlap(existingKey, key)) {
          throw new EngineError(
            "engine.override-conflict",
            `Modules "${existing}" and "${manifest.name}" both override Op "${key}". Only one Module may override an item.`,
            [existing, manifest.name],
          );
        }
      }
      overriders.set(key, manifest.name);
    }
  }
  return overriders;
}

function collide(path: string, existing: Producer, incoming: Producer): never {
  if (existing.overrides && incoming.overrides) {
    throw new EngineError(
      "engine.override-conflict",
      `Modules "${existing.module}" and "${incoming.module}" both override "${path}". Only one Module may override an item.`,
      [existing.module, incoming.module],
    );
  }
  throw new EngineError(
    "engine.path-collision",
    `Modules "${existing.module}" and "${incoming.module}" both produce "${path}". Declare an override in one of them or remove the duplicate.`,
    [existing.module, incoming.module],
  );
}

/**
 * Builds the Plan: runs Modules serially in the given order against a VFS, emitting `files` into
 * Layout-resolved Targets and running Ops, applies each manifest's `deps` and `env` and the
 * workspace wiring, then formats what this build wrote and diffs against `base`.
 */
export async function buildPlan(options: BuildPlanOptions): Promise<BuiltPlan> {
  const { modules, layout, context } = options;
  const handlers = options.opHandlers ?? defaultOpHandlers;
  const base = options.base ?? Vfs.empty();

  const writers = targetWriters(modules);
  const directories = new Map(
    [...writers].map(([target, names]) => [target, resolveTarget(layout, target, names)]),
  );
  assertOpsKnown(modules, handlers);

  const extensionPoints = new Map<string, DeclaredExtensionPoint>();
  for (const { manifest } of modules) {
    for (const point of manifest.extensionPoints) {
      extensionPoints.set(point.name, { module: manifest.name, ...point });
    }
  }

  const overriders = opOverriders(modules);
  const work = base.clone();
  const log = new ProvenanceLog();
  const producers = new Map<string, Producer>();

  for (const removal of options.removals ?? []) {
    const path = normalizeProjectPath(removal.path);
    work.delete(path);
    log.add(path, removal.module, { kind: "remove" });
  }

  const directoryOf = (target: string): string =>
    directories.get(target) ?? resolveTarget(layout, target);
  const resolvePath = (target: string, relativePath: string): string =>
    joinTargetPath(directoryOf(target), relativePath);

  writeAgentFiles(
    {
      has: (path) => work.has(path),
      paths: () => work.paths(),
      read: (path) => work.read(path),
      write: (path, content, writeOptions) => {
        work.write(path, content, writeOptions);
        log.add(normalizeProjectPath(path), coreOwner, { kind: "op", op: "agent-files" });
      },
    },
    layout,
  );

  for (const module of modules) {
    const { manifest } = module;
    const answers = defaultAnswers(manifest, options.answers[manifest.name] ?? {});
    const overriddenKeys = new Set(
      manifest.override.flatMap((entry) => ("file" in entry ? [entry.file] : [])),
    );

    for (const file of manifest.files) {
      const relativePath = posix.normalize(interpolatePath(file.to, answers));
      const path = resolvePath(file.target, relativePath);
      const ownership: Ownership = file.ownership ?? "managed";
      const incoming: Producer = {
        module: manifest.name,
        overrides: overriddenKeys.has(`${file.target}:${relativePath}`),
      };
      const existing = producers.get(path);
      const source = module.readFile(file.from);
      const content =
        typeof source === "string"
          ? interpolateImports(
              interpolateTargets(interpolateContent(source, answers), directoryOf),
              posix.dirname(path),
              resolvePath,
            )
          : source;
      const entry: ProvenanceEntry = { kind: "file", from: file.from };

      if (existing !== undefined) {
        if (incoming.overrides && !existing.overrides) {
          log.set(path, [
            { module: incoming.module, entry },
            { module: existing.module, entry: log.get(path)[0]?.entry ?? entry, overridden: true },
          ]);
        } else if (existing.overrides && !incoming.overrides) {
          log.set(path, [...log.get(path), { module: incoming.module, entry, overridden: true }]);
          continue;
        } else {
          collide(path, existing, incoming);
        }
      } else {
        if (base.has(path) && ownership !== "managed") {
          continue;
        }
        log.add(path, incoming.module, entry);
      }
      producers.set(path, incoming);
      work.write(path, content, {
        ownership,
        ...(file.mode === undefined ? {} : { mode: file.mode }),
      });
    }

    const ownOverrides = opOverrideKeys(manifest);
    for (const declaredOp of manifest.ops) {
      const op = interpolateTargetsDeep(declaredOp, directoryOf);
      const keys = opKeysOf(declaredOp);
      const overridden = keys.some((key) => {
        const overrider = overriders.get(key);
        return overrider !== undefined && overrider !== manifest.name;
      });
      const scratch = overridden ? work.clone() : work;
      const opVfs: OpVfs = {
        has: (path) => scratch.has(path),
        paths: () => scratch.paths(),
        read: (path) => scratch.read(path),
        write: (path, content, writeOptions) => {
          scratch.write(path, content, writeOptions);
          const normalized = normalizeProjectPath(path);
          if (overridden) {
            log.addOverridden(normalized, manifest.name, { kind: "op", op: op.op });
          } else {
            log.add(normalized, manifest.name, { kind: "op", op: op.op });
          }
        },
      };
      const handler = handlers.get(op.op);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Ops run serially by design
      await handler?.(
        {
          module: manifest.name,
          layout,
          context,
          answers,
          vfs: opVfs,
          overriding: keys.some((key) => ownOverrides.has(key)),
          extensionPoints,
          modulesOf: (path) => [
            ...new Set(
              log
                .get(normalizeProjectPath(path))
                .filter((entry) => entry.entry.kind === "op")
                .map((entry) => entry.module),
            ),
          ],
          resolvePath,
        },
        op,
      );
    }
  }

  const deps: Record<string, { entry: Omit<PlanDependency, "owners">; owners: Set<string> }> = {};
  const dataVfs = (module: string, op: string): OpVfs => ({
    has: (path) => work.has(path),
    paths: () => work.paths(),
    read: (path) => work.read(path),
    write: (path, content, writeOptions) => {
      work.write(path, content, writeOptions);
      log.add(normalizeProjectPath(path), module, { kind: "op", op });
    },
  });
  for (const { manifest } of modules) {
    const recorded = applyDeps({
      vfs: dataVfs(manifest.name, "deps"),
      layout,
      module: manifest.name,
      target: depsTarget(manifest, layout),
      deps: manifest.deps,
      catalog: options.catalog ?? emptyCatalog,
      resolvePath,
    });
    for (const [name, entry] of Object.entries(recorded)) {
      const known = (deps[name] ??= { entry, owners: new Set<string>() });
      known.owners.add(manifest.name);
    }
    applyEnv({ vfs: dataVfs(manifest.name, "env"), env: manifest.env, resolvePath });
  }
  wireWorkspaces(
    {
      has: (path) => work.has(path),
      paths: () => work.paths(),
      read: (path) => work.read(path),
      write: (path, content, writeOptions) => {
        work.write(path, content, writeOptions);
      },
    },
    layout,
  );

  let finalVfs = work;
  if (options.formatter !== undefined) {
    const formatted = await options.formatter.format(work.clone());
    for (const path of formatted.paths()) {
      const written = work.get(path);
      if (written === undefined) {
        continue;
      }
      if (sameContent(base.read(path), written.content)) {
        formatted.write(path, written.content);
      } else if (!sameContent(written.content, formatted.read(path))) {
        log.add(path, options.formatter.name, { kind: "formatter" });
      }
    }
    finalVfs = formatted;
  }

  return {
    changes: diffVfs(base, finalVfs, (path) => log.get(path)),
    hash: hashVfs(finalVfs),
    vfs: finalVfs,
    deps: Object.fromEntries(
      Object.entries(deps).map(([name, { entry, owners }]) => [
        name,
        { ...entry, owners: [...owners].toSorted(compareByCodepoint) },
      ]),
    ),
  };
}
