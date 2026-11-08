import type { Catalog, ModuleManifest } from "@aokit/module";
import { EngineError } from "../../engine/errors.ts";
import type { LayoutName } from "../../engine/layout.ts";
import type { OpVfs } from "../../engine/ops.ts";
import { type PackageJsonPatch, mergePackageJson } from "../../patchers/package-json/index.ts";
import { readText, writeIfChanged } from "./files.ts";

const DEPENDENCY_TYPES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const CATALOG_RANGE = "catalog";
const RANGE_PREFIX = /^[\^~>=<\s]+/;

/** What the Lockfile `deps` entry of one dependency holds. */
interface RecordedDependency {
  readonly version: string;
  readonly pinned: boolean;
  readonly source: "catalog" | "module";
}

/** Inputs of {@link applyDeps}. */
interface ApplyDepsOptions {
  readonly vfs: OpVfs;
  readonly layout: LayoutName;
  readonly module: string;
  /** The Target whose `package.json` receives every dependency that sets no `target` of its own. */
  readonly target: string;
  readonly deps: ModuleManifest["deps"];
  readonly catalog: Catalog;
  resolvePath(target: string, relativePath: string): string;
}

interface Resolved extends RecordedDependency {
  readonly written: string;
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveDependency(
  options: ApplyDepsOptions,
  name: string,
  entry: { readonly range: string; readonly pinGroup?: string | undefined },
  workspacePackage: boolean,
): Resolved {
  const fromCatalog = entry.range === CATALOG_RANGE;
  let version = entry.range;
  if (fromCatalog) {
    const catalogVersion = options.catalog.dependencies[name];
    if (catalogVersion === undefined) {
      throw new EngineError(
        "engine.file-missing",
        `Module "${options.module}" asks for "${name}" from the Catalog, but the Catalog has no such dependency. Add it to the Catalog or give the Module an explicit range.`,
        [options.module],
      );
    }
    version = catalogVersion;
  }
  const pinned = entry.pinGroup !== undefined;
  if (pinned) {
    version = version.replace(RANGE_PREFIX, "");
  }
  return {
    version,
    pinned,
    source: fromCatalog ? "catalog" : "module",
    written: workspacePackage && fromCatalog ? "catalog:" : version,
  };
}

function mergeCatalog(text: string, entries: Readonly<Record<string, string>>): string {
  const parsed: unknown = text.trim() === "" ? {} : JSON.parse(text);
  const manifest: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const existing = manifest["catalog"];
  const merged: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  for (const [name, version] of Object.entries(entries)) {
    if (!(name in merged)) {
      merged[name] = version;
    }
  }
  manifest["catalog"] = Object.fromEntries(
    Object.entries(merged).toSorted(([left], [right]) => compareKeys(left, right)),
  );
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Writes a Module's `deps` into the `package.json` of each entry's Target (default: `target`) and
 * returns what the Lockfile records. Entries that resolve to the same file, as on the single Layout,
 * merge into one patch: a single Layout has one `package.json`, so a per-entry `target` is ignored.
 * Ranges come from the Catalog; a `pinGroup` makes the version exact. In `monorepo` a workspace
 * package gets bare `catalog:` and the root `package.json` holds the Catalog entries. The recorded
 * `version` is always the resolved Catalog version, so `update` can compare it later.
 */
export function applyDeps(options: ApplyDepsOptions): Record<string, RecordedDependency> {
  const { vfs, layout, target, deps } = options;
  const recorded: Record<string, RecordedDependency> = {};
  if (deps === undefined) {
    return recorded;
  }
  const patches = new Map<string, PackageJsonPatch>();
  const catalogEntries: Record<string, string> = {};

  for (const type of DEPENDENCY_TYPES) {
    const section = deps[type];
    if (section === undefined) {
      continue;
    }
    for (const [name, entry] of Object.entries(section)) {
      const entryTarget = layout === "single" ? target : (entry.target ?? target);
      const workspacePackage = layout === "monorepo" && entryTarget !== "root";
      const resolved = resolveDependency(options, name, entry, workspacePackage);
      const packagePath = options.resolvePath(entryTarget, "package.json");
      const patch = patches.get(packagePath) ?? {};
      patch[type] = { ...patch[type], [name]: resolved.written };
      patches.set(packagePath, patch);
      recorded[name] = {
        version: resolved.version,
        pinned: resolved.pinned,
        source: resolved.source,
      };
      if (resolved.written === "catalog:") {
        catalogEntries[name] = resolved.version;
      }
    }
  }

  for (const [packagePath, patch] of patches) {
    writeIfChanged(vfs, packagePath, mergePackageJson(readText(vfs, packagePath), patch));
  }

  if (Object.keys(catalogEntries).length > 0) {
    const rootPath = options.resolvePath("root", "package.json");
    writeIfChanged(vfs, rootPath, mergeCatalog(readText(vfs, rootPath), catalogEntries));
  }
  return Object.fromEntries(
    Object.entries(recorded).toSorted(([left], [right]) => compareKeys(left, right)),
  );
}
