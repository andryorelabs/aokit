import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { xdgCacheDir } from "../xdg.ts";
import type { CachedModuleVersion, RegistryCache } from "./client.ts";
import { RegistryError } from "./errors.ts";
import { normalizeLineEndings, type Integrity } from "./integrity.ts";
import { assertSafeRelativePath } from "./remote.ts";

/** Where {@link createRegistryCache} keeps its entries. */
interface RegistryCacheOptions {
  /** The cache root; `$XDG_CACHE_HOME/aokit/registry` (or `~/.cache/aokit/registry`) by default. */
  readonly dir?: string;
}

const integrityPattern = /^sha256-[0-9a-f]{64}$/;
const manifestFile = "manifest.json";
const filesDirectory = "files";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertIntegrityKey(integrity: string, root: string): void {
  if (!integrityPattern.test(integrity)) {
    throw new RegistryError(
      "REGISTRY_PATH_UNSAFE",
      `The Module cache at ${root} was asked for the key "${integrity}", which is not an integrity.`,
      "Cache keys are `sha256-<64 hex>` Module integrities from a Registry index.",
      { path: integrity },
    );
  }
}

function isOccupied(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "EEXIST")
  );
}

/**
 * Moves `staging` to `target`, replacing what `target` held. A concurrent writer of the same
 * entry may recreate `target` in between, so an occupied target is removed and the move retried.
 */
async function replaceDirectory(staging: string, target: string, retries = 2): Promise<void> {
  await rm(target, { recursive: true, force: true });
  try {
    await rename(staging, target);
  } catch (error) {
    if (!isOccupied(error) || retries === 0) {
      throw error;
    }
    await replaceDirectory(staging, target, retries - 1);
  }
}

async function readEntryFiles(filesRoot: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(filesRoot, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return files;
    }
    throw error;
  }
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(filesRoot, join(entry.parentPath, entry.name)).split(sep).join("/"));
  const texts = await Promise.all(paths.map((path) => readFile(join(filesRoot, path), "utf8")));
  for (const [position, path] of paths.entries()) {
    files.set(path, normalizeLineEndings(texts[position] ?? ""));
  }
  return files;
}

/**
 * A {@link RegistryCache} on disk: each Module version under `<dir>/<integrity>/`, its manifest as
 * `manifest.json` and its files under `files/`. An entry is written to a temporary directory and
 * renamed into place, replacing the old one. Nothing is evicted; the client verifies every hit.
 */
export function createRegistryCache(options: RegistryCacheOptions = {}): RegistryCache {
  const root = options.dir ?? join(xdgCacheDir(process.env), "registry");
  return {
    async get(integrity: Integrity): Promise<CachedModuleVersion | undefined> {
      assertIntegrityKey(integrity, root);
      const entryRoot = join(root, integrity);
      let manifest: string;
      try {
        manifest = await readFile(join(entryRoot, manifestFile), "utf8");
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
      const files = await readEntryFiles(join(entryRoot, filesDirectory));
      return { manifest: normalizeLineEndings(manifest), files };
    },
    async put(integrity: Integrity, content: CachedModuleVersion): Promise<void> {
      assertIntegrityKey(integrity, root);
      for (const path of content.files.keys()) {
        assertSafeRelativePath(path, `Module cache entry ${integrity}`, root);
      }
      await mkdir(root, { recursive: true });
      const staging = join(root, `.staging-${randomUUID()}`);
      try {
        await mkdir(join(staging, filesDirectory), { recursive: true });
        await writeFile(join(staging, manifestFile), content.manifest, "utf8");
        await Promise.all(
          [...content.files].map(async ([path, text]) => {
            const target = join(staging, filesDirectory, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, text, "utf8");
          }),
        );
        const entryRoot = join(root, integrity);
        await replaceDirectory(staging, entryRoot);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
  };
}
