import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { AokitError } from "../cli/envelope.ts";
import type { PipelineModule } from "../pipeline/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { bundledRegistryPath } from "../registry/bundled.ts";
import { readLocalRegistry, type LocalRegistry } from "../registry/index.ts";

const urlSourcePattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const registryIndexMinimum = z.object({ minCliVersion: z.string().min(1) });

/** Where relative and `"bundled"` Registry sources resolve from. */
export interface RegistrySourceContext {
  /** The directory a relative source resolves against. */
  readonly projectDir: string;
  /** The Registry that ships with the running CLI, used for the `"bundled"` source. */
  readonly bundledRegistryPath: string;
}

/**
 * Resolves a Registry source to a local directory: `"bundled"` is the shipped Registry, a
 * relative path resolves from `projectDir`, and a URL throws `INVALID_INPUT`.
 */
export function resolveRegistrySource(source: string, context: RegistrySourceContext): string {
  if (source === "bundled") {
    return context.bundledRegistryPath;
  }
  if (urlSourcePattern.test(source)) {
    throw new AokitError(
      "INVALID_INPUT",
      `Registry source "${source}" is a URL, and remote Registries are not supported yet.`,
      "Use a local Registry path or the bundled Registry.",
    );
  }
  return isAbsolute(source) ? source : resolvePath(context.projectDir, source);
}

/** Inputs of {@link openProjectRegistry}. */
export interface OpenProjectRegistryOptions {
  /** The Project directory relative sources resolve against. */
  readonly projectDir: string;
  /** Version of the running CLI. */
  readonly cliVersion: string;
  /** Overrides the shipped Registry for the `"bundled"` source. */
  readonly bundledRegistryPath?: string | undefined;
  /** The Lockfile Registry to open; the one the locked Modules come from when absent. */
  readonly registry?: string | undefined;
}

/** The name of the Lockfile Registry the locked Modules come from. */
export function primaryRegistryName(lockfile: Lockfile): string {
  const first = Object.keys(lockfile.modules).toSorted()[0];
  return lockfile.modules[first ?? ""]?.registry ?? Object.keys(lockfile.registries)[0] ?? "";
}

/** Opens a Registry the Lockfile lists, reading it from the source the Lockfile records. */
export async function openProjectRegistry(
  lockfile: Lockfile,
  options: OpenProjectRegistryOptions,
): Promise<LocalRegistry> {
  const entry = lockfile.registries[options.registry ?? primaryRegistryName(lockfile)];
  if (entry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  const path = resolveRegistrySource(entry.source, {
    projectDir: options.projectDir,
    bundledRegistryPath: options.bundledRegistryPath ?? bundledRegistryPath,
  });
  return readLocalRegistry(path, { cliVersion: options.cliVersion });
}

/** A loaded Registry with every Module wrapped for the Engine. */
export interface LoadedRegistry {
  readonly registry: LocalRegistry;
  readonly source: string;
  readonly minCliVersion: string;
  readonly available: readonly PipelineModule[];
}

/** Wraps one Registry Module as an Engine Module that reads its files from the Registry. */
function toPipelineModule(name: string, registry: LocalRegistry): PipelineModule {
  const entry = registry.modules.get(name);
  if (entry === undefined) {
    throw new AokitError(
      "INTERNAL",
      `Module ${name} vanished from the Registry`,
      "report the issue",
    );
  }
  return {
    manifest: entry.manifest,
    integrity: entry.integrity,
    readFile(from) {
      const content = entry.files.get(from);
      if (content === undefined) {
        throw new AokitError("INTERNAL", `Module ${name} has no file ${from}`, "report the issue");
      }
      return content;
    },
  };
}

async function readMinCliVersion(registryPath: string): Promise<string> {
  const index: unknown = await Bun.file(join(registryPath, "index.json")).json();
  return registryIndexMinimum.parse(index).minCliVersion;
}

/** Reads the local Registry at `registryFlag`, or the bundled one, and wraps its Modules. */
export async function loadRegistry(
  registryFlag: string | undefined,
  cliVersion: string,
): Promise<LoadedRegistry> {
  const registryPath = resolveRegistrySource(registryFlag ?? "bundled", {
    projectDir: process.cwd(),
    bundledRegistryPath,
  });
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const available = [...registry.modules.keys()]
    .toSorted()
    .map((name) => toPipelineModule(name, registry));
  return {
    registry,
    source: registryFlag ?? "bundled",
    minCliVersion: await readMinCliVersion(registryPath),
    available,
  };
}
