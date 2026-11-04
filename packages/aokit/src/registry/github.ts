import { tmpdir } from "node:os";
import { runGit } from "../git/run.ts";
import { RegistryError } from "./errors.ts";
import { type RegistryTransport, urlTransport } from "./remote.ts";
import { formatRegistrySource, type RegistrySource } from "./source.ts";

/** A `github:owner/repo#ref` Registry source. */
type GithubSource = Extract<RegistrySource, { kind: "github" }>;

/**
 * Runs `git ls-remote <repositoryUrl> <ref>` and returns its stdout: one `<sha>\t<refname>` line
 * per matching ref. Injected by tests so they never touch the network.
 */
export type GitLsRemote = (repositoryUrl: string, ref: string) => Promise<string>;

/** A GitHub repository fixed to one commit: the Pin a Lockfile records. */
export interface GithubPin {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
}

/** The adapters {@link resolveGithubPin} resolves a ref with. */
interface ResolveGithubPinAdapters {
  readonly lsRemote: GitLsRemote;
}

/** Where raw repository files are read from, as `<base>/<owner>/<repo>/<sha>/<path>`. */
export const githubRawBaseUrl = "https://raw.githubusercontent.com";

const sha40Pattern = /^[0-9a-fA-F]{40}$/;

/**
 * The real `git ls-remote`, run through the git adapter outside any Project. Throws an `Error`
 * with git's stderr when git fails.
 */
export const gitLsRemote: GitLsRemote = async (repositoryUrl, ref) => {
  const result = await runGit(tmpdir(), ["ls-remote", repositoryUrl, ref]);
  if (result.exitCode !== 0) {
    throw new Error(`git ls-remote exited ${result.exitCode}: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

function refCandidates(ref: string): string[] {
  if (ref === "HEAD" || ref.startsWith("refs/")) {
    return [`${ref}^{}`, ref];
  }
  return [`refs/tags/${ref}^{}`, `refs/tags/${ref}`, `refs/heads/${ref}`];
}

function parseLsRemote(output: string): Map<string, string> {
  const shasByRef = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [sha = "", refName = ""] = line.trim().split("\t");
    if (sha40Pattern.test(sha) && refName !== "") {
      shasByRef.set(refName, sha.toLowerCase());
    }
  }
  return shasByRef;
}

/**
 * Resolves a `github:` source to a Pin: a `ref` that already is a 40-hex SHA is used as is (git is
 * never called), anything else is resolved with `git ls-remote`, preferring a tag over a branch of
 * the same name and the commit an annotated tag points at. Throws `REGISTRY_FETCH_FAILED` when git
 * fails and `REGISTRY_NOT_FOUND` when the repository has no such ref.
 */
export async function resolveGithubPin(
  source: GithubSource,
  adapters: ResolveGithubPinAdapters,
): Promise<GithubPin> {
  const { owner, repo, ref } = source;
  if (sha40Pattern.test(ref)) {
    return { owner, repo, sha: ref.toLowerCase() };
  }
  const registry = formatRegistrySource(source);
  if (ref.startsWith("-")) {
    throw new RegistryError(
      "REGISTRY_SOURCE_UNSUPPORTED",
      `Registry source "${registry}" names the ref "${ref}", which git would read as an option.`,
      "Use a branch, a tag or a commit SHA as the ref.",
      { registry },
    );
  }
  const repositoryUrl = `https://github.com/${owner}/${repo}.git`;
  let output: string;
  try {
    output = await adapters.lsRemote(repositoryUrl, ref);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      `Resolving ${ref} of ${registry} with git ls-remote failed: ${reason}.`,
      "Check that git is installed, the repository exists and your network connection works, then run the command again.",
      { registry, path: repositoryUrl },
    );
  }
  const shasByRef = parseLsRemote(output);
  const sha = refCandidates(ref)
    .map((candidate) => shasByRef.get(candidate))
    .find((found) => found !== undefined);
  if (sha === undefined) {
    throw new RegistryError(
      "REGISTRY_NOT_FOUND",
      `Registry source "${registry}" names the ref "${ref}", which ${repositoryUrl} does not have.`,
      "Use an existing branch, tag or commit SHA of the repository.",
      { registry, path: repositoryUrl },
    );
  }
  return { owner, repo, sha };
}

/** The `github:owner/repo#<sha>` source a Pin is recorded as. */
export function pinnedGithubSource(pin: GithubPin): GithubSource {
  return { kind: "github", owner: pin.owner, repo: pin.repo, ref: pin.sha };
}

/**
 * A transport over the Registry layout at the root of a pinned repository, read from
 * `<rawBaseUrl>/<owner>/<repo>/<sha>/<path>` with `fetchImpl`.
 */
export function githubTransport(
  pin: GithubPin,
  rawBaseUrl: string,
  fetchImpl: typeof fetch,
): RegistryTransport {
  const base = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  return urlTransport(
    `${base}/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/${pin.sha}`,
    fetchImpl,
  );
}
