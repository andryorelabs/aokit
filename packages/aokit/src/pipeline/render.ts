import { AokitError } from "../cli/envelope.ts";
import {
  assertCatalogDepsAuthenticated,
  loadProjectRegistries,
  primaryRegistryName,
  type RegistryAdapters,
  toPipelineModule,
} from "../project/registry.ts";
import { fromResolveError, toAokitError } from "../project/errors.ts";
import type { AnswerValue } from "../engine/interpolate.ts";
import { formatterForSelection } from "../format/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { Registry } from "../registry/index.ts";
import { type BuiltProject, type PipelineModule, buildProject } from "./build.ts";

const fixedNow = new Date(0);

/** Options of {@link renderFromLockfile}. */
export interface RenderFromLockfileOptions {
  /** The Project directory; relative Registry sources resolve from it. */
  readonly projectDir: string;
  /** The Registry that ships with the running CLI, used for the `"bundled"` source. */
  readonly bundledRegistryPath: string;
  /** Version of the running CLI, compared against every Registry's `minCliVersion`. */
  readonly cliVersion: string;
  /** Module name to the version to render instead of the locked one. */
  readonly versionOverride?: Readonly<Record<string, string>>;
  /** Release whose Catalog to render with instead of the Lockfile's; recorded in the result. */
  readonly release?: string;
  /** Module name to the answers to render with instead of the locked ones. */
  readonly answersOverride?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * The Lockfile's Registries, already opened and trusted by the command, by Lockfile key. When
   * absent they are opened here, trusted only by the first-party rule, the Lockfile, `trustFlags`
   * or the user config, never by a prompt.
   */
  readonly registries?: ReadonlyMap<string, Registry>;
  readonly trustFlags?: readonly string[];
  readonly adapters?: RegistryAdapters;
}

function assertCliIsNewEnough(lockfile: Lockfile, cliVersion: string): void {
  for (const [name, registry] of Object.entries(lockfile.registries)) {
    if (Bun.semver.order(cliVersion, registry.minCliVersion) < 0) {
      throw new AokitError(
        "MIN_CLI_VERSION",
        `Registry "${name}" in aokit.lock.json needs aokit ${registry.minCliVersion} or newer, but this is ${cliVersion}.`,
        "Update the aokit CLI.",
      );
    }
  }
}

async function readRegistries(
  lockfile: Lockfile,
  options: RenderFromLockfileOptions,
): Promise<ReadonlyMap<string, Registry>> {
  if (options.registries !== undefined) return options.registries;
  return loadProjectRegistries(lockfile, {
    trustFlags: options.trustFlags ?? [],
    interactive: false,
    projectDir: options.projectDir,
    cliVersion: options.cliVersion,
    bundledRegistryPath: options.bundledRegistryPath,
    adapters: options.adapters,
  });
}

function answerValues(
  module: string,
  answers: Readonly<Record<string, unknown>>,
): Record<string, AnswerValue> {
  const values: Record<string, AnswerValue> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new AokitError(
        "INVALID_INPUT",
        `Answer "${module}.${key}" in aokit.lock.json is not a string, number or boolean.`,
        "Restore aokit.lock.json from version control.",
      );
    }
    values[key] = value;
  }
  return values;
}

async function lockedModule(
  name: string,
  lockfile: Lockfile,
  registries: ReadonlyMap<string, Registry>,
  options: RenderFromLockfileOptions,
): Promise<PipelineModule> {
  const entry = lockfile.modules[name];
  const registry = registries.get(entry?.registry ?? "");
  if (entry === undefined || registry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      `Module "${name}" refers to Registry "${entry?.registry}", which aokit.lock.json does not list.`,
      "Restore aokit.lock.json from version control.",
    );
  }
  const version = options.versionOverride?.[name] ?? entry.version;
  if (!registry.versions(name).includes(version)) {
    throw new AokitError(
      "MODULE_VERSION_UNAVAILABLE",
      `Module ${name}@${version} is not available in Registry "${entry.registry}".`,
      `Run \`aokit recopy\` to render ${name} at the latest version the Registry offers.`,
      { module: name, version, registry: entry.registry },
    );
  }
  return toPipelineModule(await registry.version(name, version), entry.registry);
}

async function render(
  lockfile: Lockfile,
  options: RenderFromLockfileOptions,
): Promise<BuiltProject> {
  assertCliIsNewEnough(lockfile, options.cliVersion);
  const registries = await readRegistries(lockfile, options);
  const names = Object.keys(lockfile.modules).toSorted();
  const available = await Promise.all(
    names.map((name) => lockedModule(name, lockfile, registries, options)),
  );
  const registryName = primaryRegistryName(lockfile);
  const registryEntry = lockfile.registries[registryName];
  const registry = registries.get(registryName);
  if (registryEntry === undefined || registry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const release = options.release ?? registryEntry.release;
  const catalog = await registry.catalog(release);
  if (catalog === undefined) {
    throw new AokitError(
      "MODULE_VERSION_UNAVAILABLE",
      `Registry "${registryName}" does not hold the Catalog of Release ${release}.`,
      "Run `aokit recopy` to render with the Registry's current Release.",
      { registry: registryName, release },
    );
  }
  const formatter = formatterForSelection({
    catalog,
    modules: available.map((module) => module.manifest),
  });
  const built = await buildProject({
    selection: names.filter((name) => lockfile.modules[name]?.selected === true),
    locked: names,
    available,
    answers: Object.fromEntries(
      names.map((name) => [
        name,
        answerValues(
          name,
          options.answersOverride?.[name] ?? lockfile.modules[name]?.answers ?? {},
        ),
      ]),
    ),
    layout: lockfile.layout,
    catalog,
    context: { now: fixedNow, random: () => 0, env: {} },
    registry: {
      name: registryName,
      source: registryEntry.source,
      release,
      minCliVersion: registryEntry.minCliVersion,
    },
    registries: lockfile.registries,
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) {
    throw fromResolveError(built.error);
  }
  assertCatalogDepsAuthenticated(registry, lockfile, built.lockfile);
  return built;
}

/**
 * Renders a Project from its Lockfile alone: an empty tree, the Lockfile's Layout, Module
 * versions, answers and Release Catalog, a fixed `now` and `random`, and the running CLI's
 * formatter. Checks every Registry's `minCliVersion` before reading any Registry. A locked Module
 * version the Registry no longer holds fails with `MODULE_VERSION_UNAVAILABLE`.
 */
export async function renderFromLockfile(
  lockfile: Lockfile,
  options: RenderFromLockfileOptions,
): Promise<BuiltProject> {
  try {
    return await render(lockfile, options);
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}
