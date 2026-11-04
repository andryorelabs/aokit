import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { lockfileName } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { LockfileError, parseLockfile } from "../lockfile/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { BuiltProject } from "../pipeline/build.ts";
import { renderFromLockfile } from "../pipeline/index.ts";
import { parseAnswers } from "../project/answers.ts";
import { toAokitError } from "../project/errors.ts";
import {
  openProjectRegistries,
  type ProjectRegistries,
  openProjectRegistry,
  resolveRegistrySource,
  type RegistryAdapters,
} from "../project/registry.ts";
import { bundledRegistryPath } from "../registry/bundled.ts";

/** Inputs of {@link renderFromSource}. */
export interface FromSourceRequest {
  /** The `--from` value: an `http(s)` URL, or a local path to an `aokit.lock.json` or Project directory. */
  readonly from: string;
  /** Directory of the new Project; relative Registry sources are rewritten against it. */
  readonly directory: string;
  /** `--answer` flags; they override single answers of the source Lockfile. */
  readonly answers: readonly string[];
  readonly cliVersion: string;
  /** Every `--trust <name|source>` value; none by default. `--yes` never grants trust. */
  readonly trust?: readonly string[];
  /** Whether an untrusted Registry may be asked about; `false` by default. */
  readonly interactive?: boolean;
  /** How Registries and a URL Lockfile are reached; the real network by default. */
  readonly adapters?: RegistryAdapters | undefined;
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

function parseSourceLockfile(text: string): Lockfile {
  try {
    return parseLockfile(text).lockfile;
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("INVALID_INPUT", thrown.message, thrown.fix);
    }
    throw thrown;
  }
}

function fetchFailed(url: string, reason: string, status?: number): AokitError {
  return new AokitError(
    "REGISTRY_FETCH_FAILED",
    `[REGISTRY_FETCH_FAILED] Fetching ${url} failed: ${reason}.`,
    "Check the Lockfile URL and your network connection, then run the command again.",
    status === undefined ? { path: url } : { path: url, status },
  );
}

async function fetchLockfileText(url: string, fetchImpl: typeof fetch): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new AokitError(
      "INVALID_INPUT",
      `\`--from ${url}\` is not an http(s) URL`,
      `pass an http(s) URL or a local path, for example \`--from https://example.com/${lockfileName}\``,
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET" });
  } catch (thrown) {
    throw fetchFailed(url, thrown instanceof Error ? thrown.message : String(thrown));
  }
  if (!response.ok) {
    throw fetchFailed(url, `HTTP ${response.status}`, response.status);
  }
  try {
    return await response.text();
  } catch (thrown) {
    throw fetchFailed(url, thrown instanceof Error ? thrown.message : String(thrown));
  }
}

/** Options of {@link readLockfileSource}. */
export interface ReadLockfileSourceOptions {
  /** The `fetch` a URL source is read with; the native one by default. */
  readonly fetch?: typeof fetch | undefined;
}

/**
 * Reads the Lockfile a `--from` value names: an `http(s)` URL is fetched (`REGISTRY_FETCH_FAILED`
 * when the request fails or answers a non-2xx status), anything else is a local Lockfile path or
 * Project directory. An unparseable Lockfile is `INVALID_INPUT`.
 */
export async function readLockfileSource(
  from: string,
  options: ReadLockfileSourceOptions = {},
): Promise<Lockfile> {
  if (isUrl(from)) {
    return parseSourceLockfile(await fetchLockfileText(from, options.fetch ?? fetch));
  }
  return parseSourceLockfile(await readFile(await lockfilePathOf(from), "utf8"));
}

async function lockedManifests(
  lockfile: Lockfile,
  sourceDir: string,
  request: FromSourceRequest,
): Promise<ModuleManifest[]> {
  const perRegistry = await Promise.all(
    Object.keys(lockfile.registries).map(async (registryName) => {
      const local = await openProjectRegistry(lockfile, {
        projectDir: sourceDir,
        cliVersion: request.cliVersion,
        bundledRegistryPath,
        registry: registryName,
        trustFlags: request.trust ?? [],
        interactive: request.interactive ?? false,
        adapters: request.adapters,
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
  const manifests = await lockedManifests(lockfile, sourceDir, request);
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
        "REGISTRY_INTEGRITY_MISMATCH",
        `Module ${name}@${entry.version} in Registry "${entry.registry}": the Lockfile records ${entry.integrity}, the Registry holds ${actual}.`,
        "Restore the Registry the Lockfile was created from, or recreate the Project with `aokit create`.",
      );
    }
  }
}

function isRemoteSource(source: string): boolean {
  return /^(https?:\/\/|github:)/i.test(source);
}

function relocateRegistries(
  lockfile: Lockfile,
  sourceDir: string,
  directory: string,
): Lockfile["registries"] {
  return Object.fromEntries(
    Object.entries(lockfile.registries).map(([name, registry]) => {
      if (registry.source === "bundled" || isRemoteSource(registry.source)) {
        return [name, registry];
      }
      const absolute = resolveRegistrySource(registry.source, {
        projectDir: sourceDir,
        bundledRegistryPath,
      });
      return [name, { ...registry, source: relative(directory, absolute) || "." }];
    }),
  );
}

function withTrust(
  registries: Lockfile["registries"],
  trusted: Lockfile["registries"],
): Lockfile["registries"] {
  return Object.fromEntries(
    Object.entries(registries).map(([name, registry]) => [
      name,
      trusted[name]?.trusted === true ? { ...registry, trusted: true } : registry,
    ]),
  );
}

async function openSourceRegistries(
  lockfile: Lockfile,
  sourceDir: string,
  request: FromSourceRequest,
): Promise<ProjectRegistries> {
  try {
    return await openProjectRegistries(lockfile, {
      trustFlags: request.trust ?? [],
      interactive: request.interactive ?? false,
      projectDir: sourceDir,
      cliVersion: request.cliVersion,
      bundledRegistryPath,
      adapters: request.adapters,
    });
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}

/**
 * Renders a new Project from a Lockfile, local or fetched from an `http(s)` URL: its Layout,
 * Module versions, answers and Registries, with `--answer` flags overriding single answers. Every
 * non-first-party Registry it names goes through the trust gate, and every Module's integrity is
 * re-verified against its Registry. Returns a fresh Lockfile for the new directory.
 */
export async function renderFromSource(request: FromSourceRequest): Promise<FromSourceRender> {
  const sourceDir = isUrl(request.from)
    ? resolvePath(request.directory)
    : dirname(await lockfilePathOf(request.from));
  const source = await readLockfileSource(request.from, { fetch: request.adapters?.fetch });
  const opened = await openSourceRegistries(source, sourceDir, request);
  const overridden = await withAnswerOverrides(source, request, sourceDir);
  const built = await renderFromLockfile(overridden, {
    projectDir: sourceDir,
    bundledRegistryPath,
    cliVersion: request.cliVersion,
    registries: opened.registries,
  });
  assertIntegrity(source, built.lockfile);
  return {
    built,
    lockfile: {
      ...built.lockfile,
      registries: withTrust(
        relocateRegistries(built.lockfile, sourceDir, request.directory),
        opened.entries,
      ),
    },
  };
}
