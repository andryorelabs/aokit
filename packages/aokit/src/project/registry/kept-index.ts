import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Lockfile } from "../../lockfile/schema.ts";
import { type Registry, RegistryError } from "../../registry/index.ts";
import type { PinnedIntegrities } from "./context.ts";

const indexDocumentPattern = /\/(?:index\.json|catalog\/[^/]+\.json)$/;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readKept(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

/**
 * Wraps `fetch` so the last `index.json` and Catalog read from each URL are kept on disk and
 * served when the network is unreachable: the Module versions come from the Module cache, so a
 * read-only command works offline. An HTTP error is never replaced; a kept Catalog is still
 * verified against the index, and every Module version against its integrity.
 */
export function keepingIndexDocuments(
  fetchImpl: typeof fetch,
  dir: string,
  onKeptCopy: (url: string) => void,
): typeof fetch {
  const keep = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = join(dir, `${new Bun.CryptoHasher("sha256").update(url).digest("hex")}.json`);
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const kept = await readKept(path);
      if (kept === undefined) throw error;
      onKeptCopy(url);
      return new Response(kept, { status: 200 });
    }
    if (response.status !== 200) return response;
    const text = await response.text();
    await mkdir(dir, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
    return new Response(text, { status: 200, headers: response.headers });
  };
  const wrapped = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return indexDocumentPattern.test(new URL(url).pathname)
      ? keep(url, init)
      : fetchImpl(input, init);
  };
  return Object.assign(wrapped, { preconnect: fetchImpl.preconnect });
}

/**
 * A Registry whose index is the kept offline copy. That copy is not authenticated, so it may only
 * serve the Module versions the Lockfile pins, and only when the index lists the integrity the
 * Lockfile recorded, and only the Catalog of the Release the Lockfile records: anything else would
 * let an edited copy vouch for planted cache entries or move the Project to a forged Release.
 */
export function pinnedToLockfile(
  registry: Registry,
  pinned: PinnedIntegrities,
  lockedRelease: string | undefined,
): Registry {
  return {
    ...registry,
    catalog(release) {
      if (release === lockedRelease) return registry.catalog(release);
      return Promise.reject(
        new RegistryError(
          "REGISTRY_INTEGRITY_MISMATCH",
          `Registry "${registry.name}" is unreachable, and its kept offline index offers Release ${release}, but aokit.lock.json records ${lockedRelease ?? "no Release"}.`,
          "Reconnect to the network so the index is read and verified again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
          { registry: registry.name, expected: lockedRelease ?? "", actual: release },
        ),
      );
    },
    version(name, version) {
      const module = `${name}@${version}`;
      const expected = pinned.get(module);
      if (expected === undefined) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_FETCH_FAILED",
            `Registry "${registry.name}" is unreachable, and its kept offline index cannot vouch for ${module}, which aokit.lock.json does not pin.`,
            "Reconnect to the network and run the command again.",
            { registry: registry.name, module },
          ),
        );
      }
      const listed = registry.index.modules[name]?.versions[version]?.integrity;
      if (listed !== undefined && listed !== expected) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_INTEGRITY_MISMATCH",
            `Registry "${registry.name}" kept offline index lists ${module} with integrity ${listed}, but aokit.lock.json pins ${expected}.`,
            "Reconnect to the network so the index is read again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
            { registry: registry.name, module, expected, actual: listed },
          ),
        );
      }
      return registry.version(name, version);
    },
  };
}

/** The Registries opened from a kept offline index, whose Catalogs nothing authenticates. */
export const keptIndexRegistries = new WeakSet<Registry>();

/**
 * Checks a Render whose Catalog came from `registry` against the Lockfile it started from. When the
 * Registry was opened from its kept offline index, its Catalog is unauthenticated, so every
 * Catalog dependency the Render records must already be in the Lockfile with the same version;
 * anything else is `REGISTRY_INTEGRITY_MISMATCH`. Online Catalogs are verified by the index.
 */
export function assertCatalogDepsAuthenticated(
  registry: Registry | undefined,
  previous: Pick<Lockfile, "deps">,
  next: Pick<Lockfile, "deps">,
): void {
  if (registry === undefined || !keptIndexRegistries.has(registry)) return;
  for (const [name, entry] of Object.entries(next.deps).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (entry.source !== "catalog") continue;
    const locked = previous.deps[name];
    const recorded = locked?.source === "catalog" ? locked.version : undefined;
    if (recorded === entry.version && locked?.pinned === entry.pinned) continue;
    throw new RegistryError(
      "REGISTRY_INTEGRITY_MISMATCH",
      `Registry "${registry.name}" is unreachable, and its kept offline Catalog sets ${name} to ${entry.version}, but aokit.lock.json records ${recorded ?? "no Catalog version"}.`,
      "Reconnect to the network so the Catalog is read and verified again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
      {
        registry: registry.name,
        path: `deps.${name}`,
        expected: recorded ?? "",
        actual: entry.version,
      },
    );
  }
}
