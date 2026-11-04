import { hashTrackedFile } from "../drift/hash.ts";
import type { Vfs } from "../engine/vfs.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { serializeLockfile } from "../lockfile/serialize.ts";
import type { BuiltProject } from "../pipeline/build.ts";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "catalog",
];

/** A dependency `update` left alone although the target Release resolves it differently. */
export interface KeptDependency {
  readonly name: string;
  /** The version the Project keeps. */
  readonly kept: string;
  /** The version the target Release resolves. */
  readonly available: string;
  readonly reason: "pinned" | "user";
}

type Entry = Lockfile["deps"][string];
type Section = Record<string, unknown>;

function isSection(value: unknown): value is Section {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isSection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPackageJson(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

function keepsEntry(entry: Entry): boolean {
  return entry.pinned || entry.source === "user";
}

function restoreVersions(base: Vfs, next: Vfs, names: ReadonlySet<string>): string[] {
  const rewritten: string[] = [];
  for (const path of next.paths().filter(isPackageJson)) {
    const incoming = parseObject(next.read(path));
    const previous = parseObject(base.read(path));
    if (incoming === undefined || previous === undefined) continue;
    let changed = false;
    for (const section of dependencySections) {
      const target = incoming[section];
      const source = previous[section];
      if (!isSection(target) || !isSection(source)) continue;
      for (const name of names) {
        if (name in target && name in source && target[name] !== source[name]) {
          target[name] = source[name];
          changed = true;
        }
      }
    }
    if (changed) {
      next.write(path, `${JSON.stringify(incoming, null, 2)}\n`);
      rewritten.push(path);
    }
  }
  return rewritten;
}

/**
 * Makes the target Render keep every dependency the Project pins or owns: pinned entries keep
 * their locked version in `package.json` and the Lockfile, and `source: "user"` entries survive.
 * Returns the adjusted Render and the dependencies kept at a version the target would change.
 */
export function keepProjectDeps(
  locked: Lockfile,
  base: BuiltProject,
  next: BuiltProject,
): { readonly next: BuiltProject; readonly kept: KeptDependency[] } {
  const deps = { ...next.lockfile.deps };
  const kept: KeptDependency[] = [];
  const restored = new Set<string>();
  for (const [name, entry] of Object.entries(locked.deps).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!keepsEntry(entry)) continue;
    const incoming = deps[name];
    if (incoming === undefined) {
      deps[name] = entry;
      continue;
    }
    if (incoming.version !== entry.version) {
      kept.push({
        name,
        kept: entry.version,
        available: incoming.version,
        reason: entry.source === "user" ? "user" : "pinned",
      });
      restored.add(name);
    }
    deps[name] = {
      ...incoming,
      version: entry.version,
      pinned: entry.pinned,
      source: entry.source,
    };
  }
  const files = { ...next.lockfile.files };
  for (const path of restoreVersions(base.plan.vfs, next.plan.vfs, restored)) {
    const entry = files[path];
    const content = next.plan.vfs.read(path);
    if (entry !== undefined && content !== undefined) {
      files[path] = {
        ...entry,
        hash: hashTrackedFile(path, new TextEncoder().encode(String(content))),
      };
    }
  }
  const lockfile: Lockfile = { ...next.lockfile, deps, files };
  return {
    next: { ...next, lockfile, lockfileText: serializeLockfile(lockfile) },
    kept,
  };
}
