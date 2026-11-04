import type { RegistrySource } from "../registry/source.ts";

const githubPattern = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#[^\s#]*)?$/;

function githubIdentity(owner: string, repo: string): string {
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function urlIdentity(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * What trust is bound to for a Registry source: the repository of a `github:` source (the ref, and
 * so the Pin, may move) and the origin plus path of a URL source. Trust given to one identity never
 * carries over to another host or repository.
 */
export function sourceIdentity(source: RegistrySource): string {
  if (source.kind === "github") {
    return githubIdentity(source.owner, source.repo);
  }
  if (source.kind === "url") {
    return urlIdentity(new URL(source.url));
  }
  return `${source.kind}:${source.path}`;
}

/**
 * The identity of a source string as the user config, the Lockfile or `--trust` spell it:
 * `github:owner/repo` (with or without `#ref`) or an `http(s)://` URL. `undefined` for anything
 * else, which therefore never matches a remote Registry.
 */
export function sourceStringIdentity(source: string): string | undefined {
  const github = githubPattern.exec(source);
  if (github !== null) {
    const [, owner = "", repo = ""] = github;
    return githubIdentity(owner, repo);
  }
  if (!/^https?:\/\//i.test(source)) {
    return undefined;
  }
  try {
    return urlIdentity(new URL(source));
  } catch {
    return undefined;
  }
}
