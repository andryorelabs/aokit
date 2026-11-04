import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RegistryError } from "./errors.ts";

/**
 * Where a Registry lives. `bundled` is the Registry shipped with the CLI, `local` a directory,
 * `url` a base URL serving the local layout over HTTP, and `github` a repository at a ref.
 */
export type RegistrySource =
  | { readonly kind: "bundled"; readonly path: string }
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "url"; readonly url: string }
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

const githubSourcePattern = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([^\s#]+)$/;
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const windowsDrivePattern = /^[A-Za-z]:[\\/]/;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function invalidSource(source: string, reason: string): RegistryError {
  return new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `Registry source "${source}" is not supported: ${reason}.`,
    "Use `bundled`, a local path, a `file:` URL, an `https://` URL or `github:owner/repo#ref`.",
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
  return { kind: "url", url: base };
}

/**
 * Parses a Registry source string: `"bundled"`, `github:owner/repo#ref`, an `https://` URL (or
 * `http://` on a loopback host), a `file:` URL, or a path resolved against `projectDir`. Throws a
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
 * absolute path, the base URL without a trailing slash, or `github:owner/repo#ref`.
 */
export function formatRegistrySource(source: RegistrySource): string {
  if (source.kind === "github") {
    return `github:${source.owner}/${source.repo}#${source.ref}`;
  }
  return source.kind === "url" ? source.url : source.kind === "local" ? source.path : "bundled";
}
