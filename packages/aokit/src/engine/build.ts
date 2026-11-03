import { posix } from "node:path";
import { codeOpHandlers } from "../ops/code/index.ts";
import { dataOpHandlers } from "../ops/data/index.ts";
import { EngineError } from "./errors.ts";
import { type AnswerValue, interpolateContent, interpolatePath } from "./interpolate.ts";
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
import { type Ownership, Vfs, compareByCodepoint, normalizeProjectPath } from "./vfs.ts";

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
  /** The Project as loaded from disk; defaults to an empty tree. */
  readonly base?: Vfs;
  readonly formatter?: Formatter;
  readonly removals?: readonly Removal[];
  /** Op handlers by name; defaults to the built-in code and data registries. */
  readonly opHandlers?: ReadonlyMap<string, OpHandler>;
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
      note(op.target, manifest.name);
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

  get(path: string): readonly Provenance[] {
    return this.byPath.get(path) ?? [];
  }
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
 * Layout-resolved Targets and running Ops, then formats and diffs against `base`.
 */
export async function buildPlan(options: BuildPlanOptions): Promise<Plan> {
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

  const work = base.clone();
  const log = new ProvenanceLog();
  const producers = new Map<string, Producer>();

  for (const removal of options.removals ?? []) {
    const path = normalizeProjectPath(removal.path);
    work.delete(path);
    log.add(path, removal.module, { kind: "remove" });
  }

  const resolvePath = (target: string, relativePath: string): string =>
    joinTargetPath(directories.get(target) ?? resolveTarget(layout, target), relativePath);

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
      const content = typeof source === "string" ? interpolateContent(source, answers) : source;
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

    for (const op of manifest.ops) {
      const opVfs: OpVfs = {
        has: (path) => work.has(path),
        paths: () => work.paths(),
        read: (path) => work.read(path),
        write: (path, content, writeOptions) => {
          work.write(path, content, writeOptions);
          log.add(normalizeProjectPath(path), manifest.name, { kind: "op", op: op.op });
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

  let finalVfs = work;
  if (options.formatter !== undefined) {
    const formatted = await options.formatter.format(work.clone());
    for (const path of formatted.paths()) {
      if (work.read(path) !== formatted.read(path)) {
        log.add(path, options.formatter.name, { kind: "formatter" });
      }
    }
    finalVfs = formatted;
  }

  return {
    changes: diffVfs(base, finalVfs, (path) => log.get(path)),
    hash: hashVfs(finalVfs),
    vfs: finalVfs,
  };
}
