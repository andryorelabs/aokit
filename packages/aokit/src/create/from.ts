import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { lockfileName } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { LockfileError, parseLockfile } from "../lockfile/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { BuiltProject } from "../pipeline/build.ts";
import { renderFromLockfile } from "../pipeline/index.ts";
import { parseAnswers } from "../project/answers.ts";
import { readLocalRegistry } from "../registry/index.ts";

const bundledRegistryPath = join(import.meta.dir, "..", "..", "..", "..", "registry");

/** Inputs of {@link renderFromSource}. */
export interface FromSourceRequest {
  /** The `--from` value: a local path to an `aokit.lock.json` or to a Project directory. */
  readonly from: string;
  /** Directory of the new Project; relative Registry sources are rewritten against it. */
  readonly directory: string;
  /** `--answer` flags; they override single answers of the source Lockfile. */
  readonly answers: readonly string[];
  readonly cliVersion: string;
}

/** What {@link renderFromSource} produced. */
export interface FromSourceRender {
  readonly built: BuiltProject;
  /** The Lockfile of the new Project, with Registry sources relative to the new directory. */
  readonly lockfile: Lockfile;
}

function isUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

async function lockfilePathOf(from: string): Promise<string> {
  const path = resolvePath(from);
  try {
    return (await stat(path)).isDirectory() ? join(path, lockfileName) : path;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new AokitError(
        "INVALID_INPUT",
        `\`--from ${from}\` does not exist`,
        `pass the path of an existing ${lockfileName}, for example \`--from ../app/${lockfileName}\``,
      );
    }
    throw error;
  }
}

async function readSourceLockfile(path: string): Promise<Lockfile> {
  try {
    return parseLockfile(await readFile(path, "utf8")).lockfile;
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("INVALID_INPUT", thrown.message, thrown.fix);
    }
    throw thrown;
  }
}

function registryPath(source: string, sourceDir: string): string {
  if (source === "bundled") return bundledRegistryPath;
  return isAbsolute(source) ? source : resolvePath(sourceDir, source);
}

async function lockedManifests(
  lockfile: Lockfile,
  sourceDir: string,
  cliVersion: string,
): Promise<ModuleManifest[]> {
  const perRegistry = await Promise.all(
    Object.entries(lockfile.registries).map(async ([registryName, registry]) => {
      const local = await readLocalRegistry(registryPath(registry.source, sourceDir), {
        cliVersion,
      });
      return Object.entries(lockfile.modules)
        .filter(([, entry]) => entry.registry === registryName)
        .flatMap(([name, entry]) => local.version(name, entry.version)?.manifest ?? []);
    }),
  );
  return perRegistry.flat();
}

async function withAnswerOverrides(
  lockfile: Lockfile,
  request: FromSourceRequest,
  sourceDir: string,
): Promise<Lockfile> {
  if (request.answers.length === 0) return lockfile;
  const manifests = await lockedManifests(lockfile, sourceDir, request.cliVersion);
  const overrides = parseAnswers(request.answers, manifests);
  const modules = Object.fromEntries(
    Object.entries(lockfile.modules).map(([name, entry]) => [
      name,
      { ...entry, answers: { ...entry.answers, ...overrides[name] } },
    ]),
  );
  return { ...lockfile, modules };
}

function assertIntegrity(source: Lockfile, rendered: Lockfile): void {
  for (const [name, entry] of Object.entries(source.modules)) {
    const actual = rendered.modules[name]?.integrity;
    if (actual !== entry.integrity) {
      throw new AokitError(
        "IO_ERROR",
        `[REGISTRY_INTEGRITY_MISMATCH] Module ${name}@${entry.version} in Registry "${entry.registry}": the Lockfile records ${entry.integrity}, the Registry holds ${actual}.`,
        "Restore the Registry the Lockfile was created from, or recreate the Project with `aokit create`.",
      );
    }
  }
}

function relocateRegistries(
  lockfile: Lockfile,
  sourceDir: string,
  directory: string,
): Lockfile["registries"] {
  return Object.fromEntries(
    Object.entries(lockfile.registries).map(([name, registry]) => {
      if (registry.source === "bundled") return [name, registry];
      const absolute = registryPath(registry.source, sourceDir);
      return [name, { ...registry, source: relative(directory, absolute) || "." }];
    }),
  );
}

/**
 * Renders a new Project from a local Lockfile: its Layout, Module versions, answers and
 * Registries, with `--answer` flags overriding single answers. Rejects URL sources, re-verifies
 * every Module's integrity against its Registry, and returns a fresh Lockfile for the new
 * directory.
 */
export async function renderFromSource(request: FromSourceRequest): Promise<FromSourceRender> {
  if (isUrl(request.from)) {
    throw new AokitError(
      "INVALID_INPUT",
      `\`--from ${request.from}\` is a URL, and remote sources are not supported yet`,
      `download the Lockfile and pass its local path, for example \`--from ./${lockfileName}\``,
    );
  }
  const path = await lockfilePathOf(request.from);
  const sourceDir = dirname(path);
  const source = await readSourceLockfile(path);
  const overridden = await withAnswerOverrides(source, request, sourceDir);
  const built = await renderFromLockfile(overridden, {
    projectDir: sourceDir,
    bundledRegistryPath,
    cliVersion: request.cliVersion,
  });
  assertIntegrity(source, built.lockfile);
  return {
    built,
    lockfile: {
      ...built.lockfile,
      registries: relocateRegistries(built.lockfile, sourceDir, request.directory),
    },
  };
}
