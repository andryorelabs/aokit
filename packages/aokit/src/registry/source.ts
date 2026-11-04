import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RegistryError } from "./errors.ts";

/**
 * Where a Registry lives. `bundled` is the Registry shipped with the CLI, `local` a directory,
 * `url` a base URL serving either the local layout (`index.json`) or a shadcn Registry
 * (`registry.json`), `github` a repository at a ref, and `shadcn` a shadcn Registry.
 *
 * A `shadcn` source is either a base URL whose `registry.json` lists the items (no `namespace`), or
 * a Namespace (`namespace` set) whose `url` is the item URL template holding `{name}` and any
 * `${VAR}` placeholders unexpanded; an empty `url` means the template comes from the user config.
 */
export type RegistrySource =
  | { readonly kind: "bundled"; readonly path: string }
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "shadcn"; readonly url: string; readonly namespace?: string }
  | {
      readonly kind: "github";
      readonly owner: string;
      readonly repo: string;
      readonly ref: string;
    };

/** Where relative and `"bundled"` Registry sources resolve from. */
interface ParseRegistrySourceContext {
  /** The directory a relative path resolves against. */
  readonly projectDir: string;
  /** The Registry that ships with the running CLI, used for the `"bundled"` source. */
  readonly bundledRegistryPath: string;
}

const shadcnIndexFile = "registry.json";
const namespaceSourcePattern = /^(@[a-z0-9][a-z0-9._-]*)(?:=(.+))?$/;
const githubSourcePattern = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([^\s#]+)$/;
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const windowsDrivePattern = /^[A-Za-z]:[\\/]/;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function invalidSource(source: string, reason: string): RegistryError {
  return new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `Registry source "${source}" is not supported: ${reason}.`,
    "Use `bundled`, a local path, a `file:` URL, an `https://` URL, `github:owner/repo#ref` or a Namespace such as `@shadcn`.",
    { registry: source },
  );
}

/**
 * Whether a Registry may be read from `url`: any `https://` URL, or `http://` on a loopback host.
 * Applied to a source and to every redirect hop, so a redirect cannot downgrade the transport.
 */
export function isReadableRegistryUrl(url: URL): boolean {
  return url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname));
}

function parseUrlSource(source: string): RegistrySource {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw invalidSource(source, "it is not a valid URL");
  }
  if (url.protocol === "file:") {
    return { kind: "local", path: fileURLToPath(url) };
  }
  if (!isReadableRegistryUrl(url)) {
    throw invalidSource(source, "only https:// URLs (or http:// on a loopback host) are read");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw invalidSource(source, "a Registry URL carries no credentials, query or fragment");
  }
  const base = url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
  if (base.endsWith(`/${shadcnIndexFile}`)) {
    return { kind: "shadcn", url: base.slice(0, -shadcnIndexFile.length - 1) };
  }
  return { kind: "url", url: base };
}

function parseNamespaceSource(source: string): RegistrySource {
  const match = namespaceSourcePattern.exec(source);
  const namespace = match?.[1];
  if (namespace === undefined) {
    throw invalidSource(
      source,
      "a Namespace source is `@namespace` or `@namespace=<url template>`",
    );
  }
  const template = match?.[2];
  if (template !== undefined && !template.includes("{name}")) {
    throw invalidSource(source, "a Namespace url template must contain {name}");
  }
  return { kind: "shadcn", namespace, url: template ?? "" };
}

/**
 * Parses a Registry source string: `"bundled"`, `github:owner/repo#ref`, an `https://` URL (or
 * `http://` on a loopback host), a `file:` URL, a Namespace (`@acme`, or `@acme=<url template>` as
 * the Lockfile records it), or a path resolved against `projectDir`. A URL ending in
 * `/registry.json` is a shadcn Registry; any other URL is autodetected when it is opened. Throws a
 * `REGISTRY_SOURCE_UNSUPPORTED` RegistryError for anything else.
 */
export function parseRegistrySource(
  source: string,
  context: ParseRegistrySourceContext,
): RegistrySource {
  if (source === "bundled") {
    return { kind: "bundled", path: context.bundledRegistryPath };
  }
  if (source.startsWith("github:")) {
    const match = githubSourcePattern.exec(source);
    if (match === null) {
      throw invalidSource(source, "a GitHub source is `github:owner/repo#ref`");
    }
    const [, owner = "", repo = "", ref = ""] = match;
    return { kind: "github", owner, repo, ref };
  }
  if (source.startsWith("@")) {
    return parseNamespaceSource(source);
  }
  if (schemePattern.test(source) && !windowsDrivePattern.test(source)) {
    return parseUrlSource(source);
  }
  if (source === "") {
    throw invalidSource(source, "it is empty");
  }
  return {
    kind: "local",
    path: isAbsolute(source) ? source : resolve(context.projectDir, source),
  };
}

/**
 * The canonical string of a Registry source, as messages and the Lockfile show it: `bundled`, the
 * absolute path, the base URL without a trailing slash, `github:owner/repo#ref`, the
 * `<base>/registry.json` URL of a shadcn Registry, or `@namespace=<url template>` of a Namespace
 * (placeholders kept). {@link parseRegistrySource} reads every form back to the same source.
 */
export function formatRegistrySource(source: RegistrySource): string {
  if (source.kind === "shadcn") {
    if (source.namespace !== undefined) {
      return source.url === "" ? source.namespace : `${source.namespace}=${source.url}`;
    }
    return `${source.url}/${shadcnIndexFile}`;
  }
  if (source.kind === "github") {
    return `github:${source.owner}/${source.repo}#${source.ref}`;
  }
  return source.kind === "url" ? source.url : source.kind === "local" ? source.path : "bundled";
}
