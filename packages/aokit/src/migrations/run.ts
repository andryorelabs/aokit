import type { MigrationContext, MigrationFn, MigrationVfs } from "@aokit/module";
import { AokitError } from "../cli/envelope.ts";
import { compareByCodepoint, type Vfs } from "../engine/vfs.ts";
import type { LocalRegistry } from "../registry/index.ts";
import { selectMigrations } from "./select.ts";

/**
 * A Module the runner may migrate, in the position canonical Resolver order puts it.
 */
interface MigrationModule {
  readonly name: string;
  /** The version the Lockfile records. */
  readonly installed: string;
  /** The version the target Release fixes. */
  readonly target: string;
}

/**
 * One Migration that ran.
 */
interface MigrationProvenance {
  readonly module: string;
  readonly stage: "before" | "after";
  readonly from: string;
  readonly to: string;
  readonly script: string;
}

/**
 * Inputs of {@link runMigrations}. `registry` is a `LocalRegistry`, which only exists for `local`
 * and `bundled` sources, so scripts never load from anywhere else. `vfs` is mutated.
 */
export interface RunMigrationsOptions {
  readonly stage: "before" | "after";
  /** Modules in canonical Resolver order. */
  readonly modules: readonly MigrationModule[];
  readonly vfs: Vfs;
  readonly answers: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly context: MigrationContext;
  readonly registry: LocalRegistry;
}

/**
 * What {@link runMigrations} produced: the answers after every `before` Migration, and the
 * Migrations that ran in order.
 */
export interface RunMigrationsResult {
  readonly answers: Record<string, Record<string, unknown>>;
  readonly provenance: MigrationProvenance[];
}

function migrationVfs(vfs: Vfs): MigrationVfs {
  return {
    read: (path) => {
      const content = vfs.read(path);
      return typeof content === "string" ? content : undefined;
    },
    write: (path, content) => {
      vfs.write(path, content);
    },
    delete: (path) => {
      vfs.delete(path);
    },
    list: (prefix = "") =>
      vfs
        .paths()
        .filter((path) => path.startsWith(prefix))
        .toSorted(compareByCodepoint),
  };
}

function failure(provenance: MigrationProvenance, reason: string): AokitError {
  return new AokitError(
    "MIGRATION_FAILED",
    `Migration ${provenance.script} of Module "${provenance.module}" (${provenance.from} -> ${provenance.to}, ${provenance.stage}) failed: ${reason}`,
    `Fix or report the Migration in Module "${provenance.module}"; nothing was written to the Project.`,
    provenance,
  );
}

function describeThrown(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

async function loadScript(path: string, provenance: MigrationProvenance): Promise<MigrationFn> {
  let exported: unknown;
  try {
    const loaded: unknown = await import(path);
    exported =
      typeof loaded === "object" && loaded !== null && "default" in loaded
        ? loaded.default
        : undefined;
  } catch (thrown) {
    throw failure(provenance, describeThrown(thrown));
  }
  if (!isMigrationFn(exported)) {
    throw failure(provenance, "the script does not default-export a defineMigration function.");
  }
  return exported;
}

function isMigrationFn(value: unknown): value is MigrationFn {
  return typeof value === "function";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function isAnswers(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs the selected Migrations of one stage over `vfs`: Modules in the given order, and within a
 * Module by `to`. A `before` Migration may return the Module's migrated answers, which replace
 * them for the Migrations and Render after it; an `after` Migration's return value is ignored.
 * Any throw is `MIGRATION_FAILED`, raised before the caller writes anything.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const answers: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(options.answers).map(([name, values]) => [name, { ...values }]),
  );
  const provenance: MigrationProvenance[] = [];
  const vfs = migrationVfs(options.vfs);
  for (const module of options.modules) {
    const version = options.registry.version(module.name, module.target);
    if (version === undefined) {
      throw new AokitError(
        "MODULE_VERSION_UNAVAILABLE",
        `Registry "${options.registry.name}" does not hold ${module.name}@${module.target}.`,
        `Run \`aokit remove ${module.name}\` or choose another Release.`,
        { module: module.name, version: module.target },
      );
    }
    const selected = selectMigrations(version.manifest, module.installed, module.target).filter(
      (migration) => migration.stage === options.stage,
    );
    for (const migration of selected) {
      const entry: MigrationProvenance = {
        module: module.name,
        stage: options.stage,
        from: module.installed,
        to: migration.to,
        script: migration.script,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- Migrations run serially by design
      const script = await loadScript(version.migrationScript(migration.script), entry);
      let returned: unknown;
      try {
        returned = script({
          vfs,
          answers: structuredClone(answers[module.name] ?? {}),
          context: options.context,
        });
      } catch (thrown) {
        throw failure(entry, describeThrown(thrown));
      }
      if (isThenable(returned)) {
        returned.then(undefined, () => undefined);
        throw failure(entry, "Migrations must be synchronous; the script returned a Promise.");
      }
      if (options.stage === "before" && isAnswers(returned)) {
        answers[module.name] = { ...returned };
      }
      provenance.push(entry);
    }
  }
  return { answers, provenance };
}
