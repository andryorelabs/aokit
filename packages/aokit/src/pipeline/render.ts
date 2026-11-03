import { AokitError } from "../cli/envelope.ts";
import { resolveRegistrySource } from "../project/registry.ts";
import { fromResolveError, toAokitError } from "../project/errors.ts";
import type { AnswerValue } from "../engine/interpolate.ts";
import { formatterForSelection } from "../format/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { type LocalRegistry, readLocalRegistry } from "../registry/index.ts";
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
): Promise<Map<string, LocalRegistry>> {
  const entries = Object.entries(lockfile.registries).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const paths = entries.map(([, registry]) => resolveRegistrySource(registry.source, options));
  const registries = await Promise.all(
    paths.map((path) => readLocalRegistry(path, { cliVersion: options.cliVersion })),
  );
  const byName = new Map<string, LocalRegistry>();
  for (const [position, [name]] of entries.entries()) {
    const registry = registries[position];
    if (registry !== undefined) {
      byName.set(name, registry);
    }
  }
  return byName;
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

function lockedModule(
  name: string,
  lockfile: Lockfile,
  registries: ReadonlyMap<string, LocalRegistry>,
  options: RenderFromLockfileOptions,
): PipelineModule {
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
  const found = registry.version(name, version);
  if (found === undefined) {
    throw new AokitError(
      "MODULE_VERSION_UNAVAILABLE",
      `Module ${name}@${version} is not available in Registry "${entry.registry}".`,
      `Run \`aokit recopy\` to render ${name} at the latest version the Registry offers.`,
      { module: name, version, registry: entry.registry },
    );
  }
  return {
    manifest: found.manifest,
    integrity: found.integrity,
    readFile(from) {
      const content = found.files.get(from);
      if (content === undefined) {
        throw new AokitError("INTERNAL", `Module ${name} has no file ${from}`, "report the issue");
      }
      return content;
    },
  };
}

async function render(
  lockfile: Lockfile,
  options: RenderFromLockfileOptions,
): Promise<BuiltProject> {
  assertCliIsNewEnough(lockfile, options.cliVersion);
  const registries = await readRegistries(lockfile, options);
  const names = Object.keys(lockfile.modules).toSorted();
  const available = names.map((name) => lockedModule(name, lockfile, registries, options));
  const registryName =
    lockfile.modules[names[0] ?? ""]?.registry ?? Object.keys(lockfile.registries)[0];
  const registryEntry = lockfile.registries[registryName ?? ""];
  const registry = registries.get(registryName ?? "");
  if (registryEntry === undefined || registry === undefined || registryName === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const release = options.release ?? registryEntry.release;
  const catalog = registry.catalog(release);
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
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) {
    throw fromResolveError(built.error);
  }
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
