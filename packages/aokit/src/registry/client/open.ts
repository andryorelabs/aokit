import { RegistryError } from "../errors.ts";
import type { ReleaseCatalog } from "../schema.ts";
import type { RegistrySource } from "../source.ts";
import {
  byCodepoint,
  type ModuleVersion,
  type OpenRegistryContext,
  type Registry,
} from "./common.ts";
import { checkCliVersion, parseIndex, readCatalog, transportFor } from "./index-file.ts";
import { loadModuleVersion } from "./module-version.ts";
import { openShadcnRegistry } from "./shadcn.ts";
import { shadcnIndexFile } from "./shadcn-items.ts";

/**
 * Opens a Registry from any source behind one lazy interface. A URL source serving no `index.json`
 * but a `registry.json` is a shadcn Registry, opened as {@link openShadcnRegistry} describes, as is
 * every `shadcn` source; a shadcn Registry never reaches the index path below. It reads `index.json`, refuses an
 * unknown `schemaVersion`, a `minCliVersion` above `cliVersion` and any index path that is
 * absolute or escapes its directory, then reads and verifies the current Catalog. Nothing else is
 * read until a caller asks for it; every Module version is integrity-checked on each read, from
 * `cache` or from the source.
 */
export async function openRegistry(
  source: RegistrySource,
  context: OpenRegistryContext,
): Promise<Registry> {
  if (source.kind === "shadcn") {
    return openShadcnRegistry(source, context);
  }
  const opened = await transportFor(source, context);
  const { transport } = opened;
  const cache = source.kind === "url" || source.kind === "github" ? context.cache : undefined;
  const indexText = await transport.read("index.json");
  if (indexText === undefined && source.kind === "url") {
    const shadcnIndexText = await transport.read(shadcnIndexFile);
    if (shadcnIndexText !== undefined) {
      return openShadcnRegistry({ kind: "shadcn", url: source.url }, context, shadcnIndexText);
    }
  }
  const index = parseIndex(transport, indexText);
  checkCliVersion(index, context.cliVersion);
  const currentCatalog = await readCatalog(
    transport,
    index.name,
    index.release,
    index.releases[index.release]!,
  );
  const catalogs = new Map<string, Promise<ReleaseCatalog>>([
    [index.release, Promise.resolve(currentCatalog)],
  ]);
  const loadedVersions = new Map<string, Promise<ModuleVersion>>();
  const versions = (name: string): string[] =>
    Object.keys(index.modules[name]?.versions ?? {}).toSorted((left, right) =>
      Bun.semver.order(left, right),
    );
  const selectableVersions = (name: string): string[] =>
    versions(name).filter((version) => index.modules[name]?.versions[version]?.yanked !== true);
  return {
    name: index.name,
    source: opened.source,
    index,
    selectableVersions,
    release: index.release,
    currentCatalog,
    releases: () => Object.keys(index.releases).toSorted(byCodepoint),
    catalog(release) {
      const pointer = index.releases[release];
      if (pointer === undefined) {
        return Promise.resolve(undefined);
      }
      const known = catalogs.get(release);
      if (known !== undefined) {
        return known;
      }
      const loading = readCatalog(transport, index.name, release, pointer);
      catalogs.set(release, loading);
      loading.catch(() => catalogs.delete(release));
      return loading;
    },
    versions,
    version(name, version) {
      const entry = index.modules[name]?.versions[version];
      if (entry === undefined) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_MODULE_NOT_FOUND",
            `Registry "${index.name}" does not publish ${name}@${version}.`,
            `Pick one of the published versions: ${versions(name).join(", ") || "(none)"}.`,
            { registry: index.name, module: `${name}@${version}` },
          ),
        );
      }
      const key = `${name}@${version}`;
      const known = loadedVersions.get(key);
      if (known !== undefined) {
        return known;
      }
      const loading = loadModuleVersion(transport, cache, index, name, version, entry);
      loadedVersions.set(key, loading);
      loading.catch(() => loadedVersions.delete(key));
      return loading;
    },
  };
}
