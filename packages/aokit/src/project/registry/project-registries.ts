import { AokitError } from "../../cli/envelope.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { bundledRegistryPath as shippedRegistryPath } from "../../registry/bundled.ts";
import { formatRegistrySource, type Registry, type RegistryCache } from "../../registry/index.ts";
import { ensureTrusted } from "../../trust/gate.ts";
import { sourceIdentity } from "../../trust/identity.ts";
import {
  cacheFor,
  clash,
  type LoadProjectRegistriesOptions,
  type LockfileRegistries,
  parseSource,
  pinnedIntegrities,
  type ProjectRegistries,
  recordedSource,
  type RegistrySourceContext,
  requiredRegistry,
} from "./context.ts";
import { openSource } from "./open-source.ts";

function resolutionRank(registry: Pick<Registry, "source">): number {
  return registry.source.kind === "local" ? 1 : registry.source.kind === "bundled" ? 3 : 2;
}

function assertUniqueNames(registries: ReadonlyMap<string, Registry>): void {
  const byName = new Map<string, Registry>();
  for (const registry of registries.values()) {
    const known = byName.get(registry.name);
    if (known !== undefined && sourceIdentity(known.source) !== sourceIdentity(registry.source)) {
      throw clash(
        registry.name,
        formatRegistrySource(known.source),
        formatRegistrySource(registry.source),
      );
    }
    byName.set(registry.name, registry);
  }
}

async function openLocked(
  lockfile: LockfileRegistries,
  options: LoadProjectRegistriesOptions,
  context: RegistrySourceContext,
  cache: RegistryCache,
): Promise<Map<string, Registry>> {
  const opened = await Promise.all(
    Object.entries(lockfile.registries).map(
      async ([key, entry]) =>
        [
          key,
          await openSource(parseSource(entry.source, context), options, cache, {
            pinned: pinnedIntegrities(lockfile, key),
            lockedRelease: entry.release,
            indexOptional: true,
          }),
        ] as const,
    ),
  );
  return new Map(opened);
}

interface FlagOutcome {
  readonly key: string;
  readonly registry: Registry | undefined;
  readonly movedFrom: string | undefined;
}

async function openFlag(
  flag: string,
  lockfile: LockfileRegistries,
  locked: ReadonlyMap<string, Registry>,
  options: LoadProjectRegistriesOptions,
  context: RegistrySourceContext,
  cache: RegistryCache,
): Promise<FlagOutcome> {
  if (lockfile.registries[flag] !== undefined) {
    return { key: flag, registry: undefined, movedFrom: undefined };
  }
  const registry = await openSource(parseSource(flag, context), options, cache);
  const known = locked.get(registry.name);
  if (known === undefined) {
    return { key: registry.name, registry, movedFrom: undefined };
  }
  if (sourceIdentity(known.source) !== sourceIdentity(registry.source)) {
    throw clash(
      registry.name,
      formatRegistrySource(known.source),
      formatRegistrySource(registry.source),
    );
  }
  const before = formatRegistrySource(known.source);
  const after = formatRegistrySource(registry.source);
  const moved = registry.source.kind === "github" && before !== after ? before : undefined;
  if (moved !== undefined && options.allowPinMove !== true) {
    throw new AokitError(
      "INVALID_INPUT",
      `--registry ${flag} resolves Registry "${registry.name}" to ${after}, but aokit.lock.json pins it at ${before}.`,
      `Only \`aokit update --registry ${flag}\` moves a Pin. Pass --registry ${registry.name} to use the pinned commit.`,
      { registry: registry.name, from: before, to: after },
    );
  }
  return { key: registry.name, registry, movedFrom: moved };
}

/**
 * Opens every Registry the Lockfile lists and the one `--registry` names, through the Registry
 * client and its cache, then runs the trust gate over all of them. A `--registry` source whose
 * declared name a Lockfile Registry already uses must be the same host or repository; a different
 * `github:` ref of the same repository moves its Pin. Two Registries declaring one name with
 * different sources fail with `INVALID_INPUT` naming both sources.
 */
export async function openProjectRegistries(
  lockfile: LockfileRegistries | undefined,
  options: LoadProjectRegistriesOptions,
): Promise<ProjectRegistries> {
  const locked = lockfile ?? { registries: {} };
  const projectDir = options.projectDir ?? process.cwd();
  const context = {
    projectDir,
    bundledRegistryPath: options.bundledRegistryPath ?? shippedRegistryPath,
  };
  const cache = cacheFor(options.adapters);
  const lockedRegistries = await openLocked(locked, options, context, cache);
  assertUniqueNames(lockedRegistries);
  const flag =
    options.registryFlag === undefined
      ? undefined
      : await openFlag(options.registryFlag, locked, lockedRegistries, options, context, cache);
  const registries = new Map(lockedRegistries);
  const entries: Lockfile["registries"] = { ...locked.registries };
  if (flag?.registry !== undefined) {
    registries.set(flag.key, flag.registry);
    const previous = entries[flag.key];
    entries[flag.key] = {
      source:
        previous !== undefined && flag.movedFrom === undefined
          ? previous.source
          : recordedSource(flag.registry, projectDir),
      release: previous?.release ?? flag.registry.release,
      minCliVersion: previous?.minCliVersion ?? flag.registry.index.minCliVersion,
      ...(previous?.trusted === undefined ? {} : { trusted: previous.trusted }),
    };
  }
  const keys = [...registries.keys()];
  const decisions = await ensureTrusted(
    keys.map((key) => requiredRegistry(registries, key)),
    {
      trustFlags: options.trustFlags,
      ...(lockfile === undefined ? {} : { lockfile }),
      interactive: options.interactive,
      ...(options.adapters?.prompt === undefined ? {} : { prompt: options.adapters.prompt }),
      ...(options.adapters?.userConfig === undefined
        ? {}
        : { userConfig: options.adapters.userConfig }),
      ...(options.adapters?.env === undefined ? {} : { env: options.adapters.env }),
    },
  );
  for (const [position, decision] of decisions.entries()) {
    const key = keys[position] ?? "";
    const entry = entries[key];
    if (entry !== undefined && decision.lockfileTrusted) {
      entries[key] = { ...entry, trusted: true };
    }
  }
  const movedPins =
    flag?.movedFrom === undefined
      ? []
      : [{ registry: flag.key, from: flag.movedFrom, to: entries[flag.key]?.source ?? "" }];
  return {
    registries,
    lockedRegistries,
    flagged: flag?.key,
    entries,
    movedPins,
    decisions,
  };
}

/**
 * Opens the Lockfile's Registries, and the one `--registry` names, through the Registry client,
 * the cache and the trust gate; keyed by Lockfile key (or declared name for a new Registry).
 */
export async function loadProjectRegistries(
  lockfile: LockfileRegistries | undefined,
  options: LoadProjectRegistriesOptions,
): Promise<Map<string, Registry>> {
  return (await openProjectRegistries(lockfile, options)).registries;
}

/**
 * The order a Module name is looked up in: the `--registry` one, then local, then remote
 * Registries in Lockfile order, then the bundled one.
 */
export function resolutionOrder(set: {
  readonly registries: ReadonlyMap<string, Pick<Registry, "source">>;
  readonly flagged: string | undefined;
}): string[] {
  const keys = [...set.registries.keys()].filter((key) => key !== set.flagged);
  const ordered = keys
    .map((key, position) => ({
      key,
      position,
      rank: resolutionRank(requiredRegistry(set.registries, key)),
    }))
    .toSorted((left, right) => left.rank - right.rank || left.position - right.position)
    .map(({ key }) => key);
  return set.flagged === undefined ? ordered : [set.flagged, ...ordered];
}
