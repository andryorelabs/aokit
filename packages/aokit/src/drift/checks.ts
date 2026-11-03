import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import type { Lockfile } from "../lockfile/schema.ts";
import { RegistryError, readLocalRegistry, type LocalRegistry } from "../registry/index.ts";
import { resolve } from "../resolver/resolve.ts";

/** One thing wrong with a Project besides file drift, with the command that fixes it. */
export interface ProjectProblem {
  readonly kind: "cli" | "registry" | "integrity" | "resolver" | "deps";
  readonly message: string;
  readonly fix: string;
}

/** Inputs of {@link checkProject}. */
export interface CheckProjectOptions {
  readonly cliVersion: string;
  /** The Registry that ships with the running CLI, used for the `"bundled"` source. */
  readonly bundledRegistryPath: string;
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const lockedVersionPrefixes = ["catalog:", "workspace:"];

function sourcePath(source: string, dir: string, options: CheckProjectOptions): string | null {
  if (source === "bundled") return options.bundledRegistryPath;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) return null;
  return isAbsolute(source) ? source : resolvePath(dir, source);
}

function checkMinCliVersion(lockfile: Lockfile, cliVersion: string): ProjectProblem[] {
  return Object.entries(lockfile.registries)
    .filter(([, registry]) => Bun.semver.order(cliVersion, registry.minCliVersion) < 0)
    .map(([name, registry]) => ({
      kind: "cli",
      message: `Registry "${name}" needs aokit ${registry.minCliVersion} or newer, but this is ${cliVersion}.`,
      fix: "Update the aokit CLI.",
    }));
}

async function readOne(
  name: string,
  source: string,
  dir: string,
  options: CheckProjectOptions,
): Promise<{ registry: LocalRegistry } | { problem: ProjectProblem }> {
  const path = sourcePath(source, dir, options);
  if (path === null) {
    return {
      problem: {
        kind: "registry",
        message: `Registry "${name}" has the URL source ${source}, which this CLI cannot read yet.`,
        fix: "Point the Registry at a local path in aokit.lock.json.",
      },
    };
  }
  try {
    return { registry: await readLocalRegistry(path, { cliVersion: options.cliVersion }) };
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error;
    return {
      problem: {
        kind: error.code === "REGISTRY_INTEGRITY_MISMATCH" ? "integrity" : "registry",
        message: `Registry "${name}" cannot be read: [${error.code}] ${error.message}`,
        fix: error.fix,
      },
    };
  }
}

async function readRegistries(
  dir: string,
  lockfile: Lockfile,
  options: CheckProjectOptions,
): Promise<{ registries: Map<string, LocalRegistry>; problems: ProjectProblem[] }> {
  const registries = new Map<string, LocalRegistry>();
  const problems: ProjectProblem[] = [];
  const entries = Object.entries(lockfile.registries).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const outcomes = await Promise.all(
    entries.map(([name, entry]) => readOne(name, entry.source, dir, options)),
  );
  for (const [index, outcome] of outcomes.entries()) {
    if ("problem" in outcome) problems.push(outcome.problem);
    else registries.set(entries[index]?.[0] ?? "", outcome.registry);
  }
  return { registries, problems };
}

function checkModules(
  lockfile: Lockfile,
  registries: ReadonlyMap<string, LocalRegistry>,
): { manifests: ModuleManifest[]; problems: ProjectProblem[] } {
  const manifests: ModuleManifest[] = [];
  const problems: ProjectProblem[] = [];
  for (const [name, entry] of Object.entries(lockfile.modules).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const registry = registries.get(entry.registry);
    if (registry === undefined) continue;
    const found = registry.version(name, entry.version);
    if (found === undefined) {
      problems.push({
        kind: "registry",
        message: `Module ${name}@${entry.version} is not in Registry "${entry.registry}".`,
        fix: "aokit recopy",
      });
      continue;
    }
    manifests.push(found.manifest);
    if (found.integrity !== entry.integrity) {
      problems.push({
        kind: "integrity",
        message: `Module ${name}@${entry.version} integrity differs: lockfile ${entry.integrity}, Registry ${found.integrity}.`,
        fix: "aokit recopy",
      });
    }
  }
  return { manifests, problems };
}

function checkResolver(lockfile: Lockfile, manifests: ModuleManifest[]): ProjectProblem[] {
  const names = Object.keys(lockfile.modules);
  if (manifests.length !== names.length) return [];
  const selected = names.filter((name) => lockfile.modules[name]?.selected === true);
  const result = resolve({ modules: selected, locked: names }, manifests);
  if (result.ok) return [];
  return [
    {
      kind: "resolver",
      message: `[${result.error.code}] ${result.error.message}`,
      fix: result.error.fix,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed `package.json`, or `null` when it is missing or not valid JSON (its deps then count as missing). */
async function readManifest(dir: string, path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, path), "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error)) return null;
    throw error;
  }
}

async function readDeclaredDependencies(
  dir: string,
  lockfile: Lockfile,
): Promise<Map<string, Set<string>>> {
  const declared = new Map<string, Set<string>>();
  const manifests = Object.keys(lockfile.files).filter(
    (path) => path === "package.json" || path.endsWith("/package.json"),
  );
  const parsedManifests = await Promise.all(manifests.map((path) => readManifest(dir, path)));
  for (const parsed of parsedManifests) {
    if (!isRecord(parsed)) continue;
    for (const field of dependencyFields) {
      const section = parsed[field];
      if (!isRecord(section)) continue;
      for (const [name, version] of Object.entries(section)) {
        if (typeof version !== "string") continue;
        const versions = declared.get(name) ?? new Set<string>();
        versions.add(version);
        declared.set(name, versions);
      }
    }
  }
  return declared;
}

async function checkDeps(dir: string, lockfile: Lockfile): Promise<ProjectProblem[]> {
  const declared = await readDeclaredDependencies(dir, lockfile);
  const problems: ProjectProblem[] = [];
  for (const [name, dep] of Object.entries(lockfile.deps).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const owners = dep.owners.length === 0 ? "the Lockfile" : dep.owners.join(", ");
    const versions = declared.get(name);
    if (versions === undefined) {
      problems.push({
        kind: "deps",
        message: `Dependency ${name}@${dep.version} (${owners}) is missing from package.json.`,
        fix: `aokit restore package.json, or aokit remove ${dep.owners[0] ?? "<module>"}`,
      });
    } else if (
      ![...versions].some(
        (actual) =>
          actual === dep.version ||
          lockedVersionPrefixes.some((prefix) => actual.startsWith(prefix)),
      )
    ) {
      problems.push({
        kind: "deps",
        message: `Dependency ${name} is ${[...versions].join(", ")} in package.json but ${dep.version} in the Lockfile.`,
        fix: "aokit restore package.json",
      });
    }
  }
  return problems;
}

/**
 * Checks everything about a Project except file drift: the Lockfile's `minCliVersion`, each
 * Module's integrity against its Registry, the Resolver over the locked Modules, and the
 * `package.json` dependencies against the Lockfile `deps`. Reads only.
 */
export async function checkProject(
  dir: string,
  lockfile: Lockfile,
  options: CheckProjectOptions,
): Promise<ProjectProblem[]> {
  const cliProblems = checkMinCliVersion(lockfile, options.cliVersion);
  if (cliProblems.length > 0) return cliProblems;
  const { registries, problems: registryProblems } = await readRegistries(dir, lockfile, options);
  const { manifests, problems: moduleProblems } = checkModules(lockfile, registries);
  return [
    ...registryProblems,
    ...moduleProblems,
    ...checkResolver(lockfile, manifests),
    ...(await checkDeps(dir, lockfile)),
  ];
}
