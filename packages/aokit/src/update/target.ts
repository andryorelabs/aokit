import { AokitError } from "../cli/envelope.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { LocalRegistry } from "../registry/index.ts";

/** The Release an update moves to and the version it fixes for every locked Module. */
export interface UpdateTarget {
  /** The target Release. */
  readonly release: string;
  /** Locked Module name to the version the target Release fixes. */
  readonly versions: Readonly<Record<string, string>>;
  /** True when the Lockfile already records this Release and every Module at its target version. */
  readonly upToDate: boolean;
}

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function latestRelease(registry: LocalRegistry): string {
  const releases = registry.releases().toSorted((left, right) => Bun.semver.order(left, right));
  return releases.at(-1) ?? registry.release;
}

function lockedRelease(lockfile: Lockfile, registry: LocalRegistry): string {
  const own = lockfile.registries[registry.name];
  const fallback = Object.values(lockfile.registries)[0];
  return (own ?? fallback)?.release ?? registry.release;
}

/**
 * The version an update installs for a Module the Release Catalog maps to `target`. A Yanked
 * `target` is never selected unless the Project already runs it; it falls back to the highest
 * selectable version between `locked` and `target`, and otherwise keeps `locked`: an update never
 * downgrades.
 */
function selectUnyanked(
  registry: LocalRegistry,
  name: string,
  target: string,
  locked: string,
): string {
  const selectable = registry.selectableVersions(name);
  if (selectable.includes(target) || target === locked) {
    return target;
  }
  const fallback = selectable
    .toReversed()
    .find((version) => Bun.semver.order(version, target) <= 0);
  return fallback !== undefined && Bun.semver.order(fallback, locked) >= 0 ? fallback : locked;
}

function chooseRelease(
  lockfile: Lockfile,
  registry: LocalRegistry,
  to: string | undefined,
): { release: string; locked: string } {
  const locked = lockedRelease(lockfile, registry);
  const release = to ?? latestRelease(registry);
  if (!registry.releases().includes(release)) {
    throw new AokitError(
      "INVALID_INPUT",
      `Release ${release} is not published by Registry "${registry.name}".`,
      `Pick one of: ${registry.releases().join(", ")}.`,
    );
  }
  if (Bun.semver.order(release, locked) < 0) {
    throw new AokitError(
      "INVALID_INPUT",
      `Release ${release} is older than the ${locked} this Project is on, and update does not downgrade.`,
      `Pass a Release of ${locked} or newer with --to.`,
    );
  }
  return { release, locked };
}

/**
 * Chooses the Release an update moves to, the latest one the Registry index lists or `to`, and
 * the Module versions that Release's Catalog map fixes, never the latest Module version. A `to` that is not published, or is older than the Lockfile's
 * Release, is `INVALID_INPUT`. A locked Module the Registry no longer offers is
 * `MODULE_VERSION_UNAVAILABLE`, and the fix suggests removing it.
 */
export function resolveUpdateTarget(
  lockfile: Lockfile,
  registry: LocalRegistry,
  to?: string,
): UpdateTarget {
  const { release, locked } = chooseRelease(lockfile, registry, to);
  const releaseModules = registry.catalog(release)?.modules ?? {};
  const versions: Record<string, string> = {};
  let upToDate = release === locked;
  const entries = Object.entries(lockfile.modules).toSorted(([left], [right]) =>
    byCodepoint(left, right),
  );
  for (const [name, entry] of entries) {
    const target = releaseModules[name];
    if (target === undefined) {
      throw new AokitError(
        "MODULE_VERSION_UNAVAILABLE",
        `Module "${name}" is not part of Release ${release} of Registry "${registry.name}".`,
        `Run \`aokit remove ${name}\` to drop it, then run the update again.`,
        { module: name, release, registry: registry.name },
      );
    }
    const chosen = selectUnyanked(registry, name, target, entry.version);
    versions[name] = chosen;
    upToDate &&= chosen === entry.version;
  }
  return { release, versions, upToDate };
}
