import type { RegistrySource } from "../registry/source.ts";

const githubPattern = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#[^\s#]*)?$/;
const namespacePattern = /^(@[a-z0-9][a-z0-9._-]*)=(.+)$/;
const shadcnIndexSuffix = "/registry.json";

function githubIdentity(owner: string, repo: string): string {
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function urlIdentity(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * The identity of a Namespace: its name plus the origin and path its URL template points at before
 * `{name}`, so the same name configured for another host is another identity. A template whose
 * host is itself a `${VAR}` placeholder is compared as written.
 */
function namespaceIdentity(namespace: string, template: string): string {
  const prefix = template.split("{name}")[0] ?? template;
  let location: string;
  try {
    location = urlIdentity(new URL(prefix));
  } catch {
    location = prefix.replace(/\/+$/, "");
  }
  return `${namespace}=${location}`;
}

/**
 * What trust is bound to for a Registry source: the repository of a `github:` source (the ref, and
 * so the Pin, may move), the origin plus path of a URL or shadcn Registry, and the name plus URL
 * template location of a Namespace. Trust given to one identity never carries over to another
 * host or repository, and a Namespace name pointed at another host is another identity.
 */
export function sourceIdentity(source: RegistrySource): string {
  if (source.kind === "github") {
    return githubIdentity(source.owner, source.repo);
  }
  if (source.kind === "url") {
    return urlIdentity(new URL(source.url));
  }
  if (source.kind === "shadcn") {
    return source.namespace === undefined
      ? urlIdentity(new URL(source.url))
      : namespaceIdentity(source.namespace, source.url);
  }
  return `${source.kind}:${source.path}`;
}

/**
 * The identity of a source string as the user config, the Lockfile or `--trust` spell it:
 * `github:owner/repo` (with or without `#ref`), an `http(s)://` URL (a trailing `/registry.json`
 * names its shadcn Registry directory), or `@namespace=<url template>`. `undefined` for anything
 * else, a bare `@namespace` included, which therefore never matches a remote Registry.
 */
export function sourceStringIdentity(source: string): string | undefined {
  const github = githubPattern.exec(source);
  if (github !== null) {
    const [, owner = "", repo = ""] = github;
    return githubIdentity(owner, repo);
  }
  const namespace = namespacePattern.exec(source);
  if (namespace !== null) {
    const [, name = "", template = ""] = namespace;
    return namespaceIdentity(name, template);
  }
  if (!/^https?:\/\//i.test(source)) {
    return undefined;
  }
  try {
    const url = new URL(source);
    if (url.pathname.endsWith(shadcnIndexSuffix)) {
      url.pathname = url.pathname.slice(0, -shadcnIndexSuffix.length);
    }
    return urlIdentity(url);
  } catch {
    return undefined;
  }
}
