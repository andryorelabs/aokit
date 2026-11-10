import { join } from "node:path";
import {
  githubRawBaseUrl,
  gitLsRemote,
  pinnedGithubSource,
  resolveGithubPin,
} from "../../registry/github.ts";
import {
  formatRegistrySource,
  openRegistry,
  type Registry,
  type RegistryCache,
  RegistryError,
  type RegistrySource,
} from "../../registry/index.ts";
import { xdgCacheDir } from "../../xdg.ts";
import type { LoadProjectRegistriesOptions, PinnedIntegrities } from "./context.ts";
import { withRegistryDependencies } from "./dependencies.ts";
import { keepingIndexDocuments, keptIndexRegistries, pinnedToLockfile } from "./kept-index.ts";

/** What {@link openSource} passes on besides the source. */
interface OpenSourceExtras {
  /** Module `name@version` to the integrity the Lockfile pins for the Registry being opened. */
  readonly pinned?: PinnedIntegrities;
  readonly lockedRelease?: string | undefined;
  /** The shadcn items to read at open; every item `registry.json` lists when absent. */
  readonly items?: readonly string[];
  /**
   * Whether a shadcn `registry.json` the host does not serve reads as an empty index: for a
   * Registry the Lockfile records or one opened for explicit items, never for a bare `--registry`.
   */
  readonly indexOptional?: boolean;
  /** The source a shadcn Registry reports instead of its URL: the Pin of a `github:` source. */
  readonly reportedSource?: RegistrySource;
  /** The commit SHA of the `github:` Pin a shadcn Registry is read at; it versions its items. */
  readonly sourceSha?: string;
}

const shadcnIndexPath = /\/registry\.json$/;
const jsonPath = /\.json$/;

/**
 * Wraps `fetch` so every JSON document read while a Registry opens is kept in `captured`, which is
 * how the raw shadcn items (and their `registryDependencies`, which the Adapted Module drops) are
 * seen. With `synthesizeIndex`, a `registry.json` the host does not serve (404) reads as an empty
 * index, so a single item URL opens without one: only requested and pinned items are read then.
 */
function capturingItems(
  fetchImpl: typeof fetch,
  captured: string[],
  synthesizeIndex: boolean,
): typeof fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await fetchImpl(input, init);
    const { pathname } = new URL(url);
    if (synthesizeIndex && response.status === 404 && shadcnIndexPath.test(pathname)) {
      return new Response('{"items":[]}', { status: 200 });
    }
    if (response.status === 200 && jsonPath.test(pathname) && !shadcnIndexPath.test(pathname)) {
      captured.push(await response.clone().text());
    }
    return response;
  };
  return Object.assign(wrapped, { preconnect: fetchImpl.preconnect });
}

export async function openSource(
  source: RegistrySource,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras = {},
): Promise<Registry> {
  const pinned = extras.pinned ?? new Map<string, string>();
  if (source.kind === "github") {
    return openGithubSource(source, options, cache, extras);
  }
  const { adapters } = options;
  const documents = join(xdgCacheDir(adapters?.env ?? process.env), "registry-index");
  const index = { kept: false };
  const captured: string[] = [];
  const synthesizeIndex =
    source.kind === "shadcn" &&
    (extras.indexOptional === true || (extras.items?.length ?? 0) > 0 || pinned.size > 0);
  const registry = await openRegistry(source, {
    cliVersion: options.cliVersion,
    cache,
    fetch: keepingIndexDocuments(
      capturingItems(adapters?.fetch ?? fetch, captured, synthesizeIndex),
      documents,
      (url) => {
        if (url.endsWith("/index.json")) index.kept = true;
      },
    ),
    ...(adapters?.github === undefined ? {} : { github: { ...adapters.github } }),
    pinned,
    ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir }),
    ...(adapters?.env === undefined ? {} : { env: adapters.env }),
    ...(adapters?.userConfig === undefined ? {} : { userConfig: adapters.userConfig }),
    ...(extras.items === undefined ? {} : { items: extras.items }),
    ...(extras.sourceSha === undefined ? {} : { sourceSha: extras.sourceSha }),
  });
  if (registry.source.kind === "shadcn") {
    const reported =
      extras.reportedSource === undefined
        ? registry
        : { ...registry, source: extras.reportedSource };
    return withRegistryDependencies(
      reported,
      captured,
      cache,
      formatRegistrySource(registry.source),
      extras.sourceSha,
    );
  }
  if (!index.kept) return registry;
  const guarded = pinnedToLockfile(registry, pinned, extras.lockedRelease);
  keptIndexRegistries.add(guarded);
  return guarded;
}

/**
 * Opens a `github:` source: an aokit Registry at the root of the pinned repository, or, when the
 * repository serves no `index.json`, the shadcn items at its root, reported (and recorded) as the
 * same `github:owner/repo#<sha40>` Pin so trust stays bound to the repository.
 */
async function openGithubSource(
  source: Extract<RegistrySource, { kind: "github" }>,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras,
): Promise<Registry> {
  const github = options.adapters?.github;
  const pin = await resolveGithubPin(source, { lsRemote: github?.lsRemote ?? gitLsRemote });
  const pinnedSource = pinnedGithubSource(pin);
  const opened = async (): Promise<Registry | undefined> => {
    try {
      return await openNonGithub(pinnedSource, options, cache, extras);
    } catch (error) {
      if (error instanceof RegistryError && error.code === "REGISTRY_NOT_FOUND") return undefined;
      throw error;
    }
  };
  const pinsAdaptedModules = [...(extras.pinned?.keys() ?? [])].some((key) => key.startsWith("@"));
  const aokit = pinsAdaptedModules || extras.items !== undefined ? undefined : await opened();
  if (aokit !== undefined) return aokit;
  const rawBase = (github?.rawBaseUrl ?? githubRawBaseUrl).replace(/\/$/, "");
  return openSource(
    {
      kind: "shadcn",
      url: `${rawBase}/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/${pin.sha}`,
    },
    options,
    cache,
    { ...extras, items: extras.items ?? [], reportedSource: pinnedSource, sourceSha: pin.sha },
  );
}

/** Opens a pinned `github:` source as an aokit Registry, through the kept-index path. */
async function openNonGithub(
  source: Extract<RegistrySource, { kind: "github" }>,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras,
): Promise<Registry> {
  const { adapters } = options;
  const documents = join(xdgCacheDir(adapters?.env ?? process.env), "registry-index");
  const index = { kept: false };
  const registry = await openRegistry(source, {
    cliVersion: options.cliVersion,
    cache,
    fetch: keepingIndexDocuments(adapters?.fetch ?? fetch, documents, (url) => {
      if (url.endsWith("/index.json")) index.kept = true;
    }),
    ...(adapters?.github === undefined ? {} : { github: { ...adapters.github } }),
  });
  if (!index.kept) return registry;
  const guarded = pinnedToLockfile(registry, extras.pinned ?? new Map(), extras.lockedRelease);
  keptIndexRegistries.add(guarded);
  return guarded;
}
