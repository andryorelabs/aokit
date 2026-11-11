import { mkdir, mkdtemp, rename as renamePath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AokitError } from "../../cli/envelope.ts";
import { xdgCacheDir } from "../../xdg.ts";
import { RegistryError } from "../errors.ts";

/** One Registry file embedded in the binary: its path under the Registry root and where to read it. */
interface EmbeddedRegistryFile {
  readonly path: string;
  readonly source: string;
}

/** The first-party Registry embedded in the binary, identified by a hash of its content. */
export interface EmbeddedRegistry {
  readonly contentHash: string;
  readonly files: readonly EmbeddedRegistryFile[];
}

type CacheEnvironment = Readonly<Record<string, string | undefined>>;

let registeredRegistry: EmbeddedRegistry | undefined;
let pendingExtraction: Promise<void> | undefined;

/** Called once by the binary entry before the CLI loads; the source and the npm package never call it. */
export function registerEmbeddedRegistry(registry: EmbeddedRegistry): void {
  registeredRegistry = registry;
}

/** Forgets the registered Registry and any extraction in flight, so a test can start from the state of the source and the npm package. */
export function resetEmbeddedRegistry(): void {
  registeredRegistry = undefined;
  pendingExtraction = undefined;
}

/** Whether this process is the binary, which embeds the Registry instead of reading the repository. */
export function hasEmbeddedRegistry(): boolean {
  return registeredRegistry !== undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Bun.file(join(path, "index.json")).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

const transientRenameCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
const renameAttempts = 8;
const renameBackoffMs = 40;

/**
 * Renames a freshly written directory. Windows refuses with EPERM, EBUSY or EACCES while an
 * antivirus scan or an indexer still holds the new files, so those codes are retried with a
 * growing delay before the last error is thrown.
 */
export async function renameWithRetry(
  source: string,
  destination: string,
  rename: (source: string, destination: string) => Promise<void> = renamePath,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each retry must wait for the previous attempt
      await rename(source, destination);
      return;
    } catch (thrown) {
      const code = thrown instanceof Error && "code" in thrown ? String(thrown.code) : "";
      if (attempt >= renameAttempts || !transientRenameCodes.has(code)) throw thrown;
      // oxlint-disable-next-line eslint/no-await-in-loop -- backs off before the next attempt
      await Bun.sleep(renameBackoffMs * attempt);
    }
  }
}

/**
 * Writes `registry` to `<cacheRoot>/bundled-registry/<content-hash>/` through a temporary sibling
 * directory and one rename, and returns that directory. An existing copy is reused as it is.
 */
export async function extractRegistryTo(
  registry: EmbeddedRegistry,
  cacheRoot: string,
): Promise<string> {
  const parent = join(cacheRoot, "bundled-registry");
  const target = join(parent, registry.contentHash);
  if (await pathExists(target)) return target;
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.staging-${registry.contentHash}-`));
  try {
    await Promise.all(
      registry.files.map(async (file) => {
        const destination = join(staging, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await Bun.write(destination, Bun.file(file.source));
      }),
    );
    await renameWithRetry(staging, target);
  } catch (thrown) {
    await rm(staging, { recursive: true, force: true });
    if (await pathExists(target)) return target;
    throw thrown;
  }
  return target;
}

/** Where {@link ensureEmbeddedRegistry} puts the embedded Registry, whether or not it exists yet. */
export function embeddedRegistryTarget(env: CacheEnvironment): string {
  if (registeredRegistry === undefined) {
    throw new AokitError(
      "REGISTRY_NOT_EMBEDDED",
      "No Registry is embedded in this build of aokit.",
      "Use a released aokit binary, or pass --registry to point at a Registry source.",
    );
  }
  return join(xdgCacheDir(env), "bundled-registry", registeredRegistry.contentHash);
}

/**
 * {@link extractRegistryTo} where any filesystem failure becomes a `REGISTRY_EXTRACT_FAILED`
 * {@link RegistryError} naming the target directory and the original cause.
 */
export async function extractRegistryOrFail(
  registry: EmbeddedRegistry,
  cacheRoot: string,
): Promise<string> {
  try {
    return await extractRegistryTo(registry, cacheRoot);
  } catch (thrown) {
    const target = join(cacheRoot, "bundled-registry", registry.contentHash);
    const cause = thrown instanceof Error ? thrown.message : String(thrown);
    throw new RegistryError(
      "REGISTRY_EXTRACT_FAILED",
      `Could not extract the embedded Registry to ${target}: ${cause}`,
      "Make the cache directory writable, or set XDG_CACHE_HOME to a writable absolute directory.",
      { path: target },
    );
  }
}

/**
 * Extracts the embedded Registry into the cache directory once per process; a no-op when this
 * process embeds no Registry. Called by the Registry client before it reads the `"bundled"` source.
 */
export function ensureEmbeddedRegistry(env: CacheEnvironment): Promise<void> {
  if (registeredRegistry === undefined) return Promise.resolve();
  const registry = registeredRegistry;
  pendingExtraction ??= extractRegistryOrFail(registry, xdgCacheDir(env)).then(
    () => undefined,
    (thrown: unknown) => {
      pendingExtraction = undefined;
      throw thrown;
    },
  );
  return pendingExtraction;
}
