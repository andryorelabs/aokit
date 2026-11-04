import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RegistryError } from "./errors.ts";
import { normalizeLineEndings } from "./integrity.ts";
import { isReadableRegistryUrl } from "./source.ts";

/**
 * Reads files of one Registry by their path relative to its root (`index.json`,
 * `catalog/<release>.json`, `modules/<name>/<version>/...`). Every path is checked with
 * {@link assertSafeRelativePath} before anything is read.
 */
export interface RegistryTransport {
  /** The root directory or base URL, for messages. */
  readonly location: string;
  /** The LF-normalized text of a file, or `undefined` when the Registry does not hold it. */
  read(path: string): Promise<string | undefined>;
  /** The absolute local path of a file, for a transport that reads from disk. */
  readonly localPath?: (path: string) => string;
}

const windowsDrivePattern = /^[A-Za-z]:/;
const fetchTimeoutMilliseconds = 30_000;

function hasControlCharacter(text: string): boolean {
  for (let position = 0; position < text.length; position += 1) {
    const code = text.charCodeAt(position);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Throws a `REGISTRY_PATH_UNSAFE` RegistryError unless `path` is a plain relative path that stays
 * inside its root: no leading `/`, no backslash, no drive letter, no control character and no
 * empty, `.` or `..` segment.
 */
export function assertSafeRelativePath(path: string, subject: string, registry: string): void {
  const segments = path.split("/");
  const unsafe =
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    windowsDrivePattern.test(path) ||
    hasControlCharacter(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (unsafe) {
    throw new RegistryError(
      "REGISTRY_PATH_UNSAFE",
      `${subject} lists the path "${path}", which is absolute or escapes its directory.`,
      "The Registry index is malformed or hostile. Do not use it; rebuild it with `bun run registry:build`.",
      { registry, path },
    );
  }
}

/**
 * A transport over a Registry directory on disk.
 */
export function localTransport(root: string): RegistryTransport {
  return {
    location: root,
    async read(path) {
      assertSafeRelativePath(path, `Registry at ${root}`, root);
      try {
        return normalizeLineEndings(await readFile(join(root, path), "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },
    localPath: (path) => {
      assertSafeRelativePath(path, `Registry at ${root}`, root);
      return resolve(root, path);
    },
  };
}

function fetchFailed(url: string, reason: string, status?: number): RegistryError {
  return new RegistryError(
    "REGISTRY_FETCH_FAILED",
    `Fetching ${url} failed: ${reason}.`,
    "Check the Registry URL and your network connection, then run the command again.",
    status === undefined ? { path: url } : { path: url, status },
  );
}

const maximumRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/** Where a redirect chain sends the caller's headers: only to `origin`, until a hop leaves it. */
interface HeaderScope {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
}

function headersFor(target: string, scope: HeaderScope | undefined): Record<string, string> {
  return scope !== undefined && new URL(target).origin === scope.origin ? { ...scope.headers } : {};
}

async function fetchFollowingSafeRedirects(
  target: string,
  fetchImpl: typeof fetch,
  scope: HeaderScope | undefined,
  redirectsLeft: number = maximumRedirects,
): Promise<Response> {
  const response = await fetchImpl(target, {
    method: "GET",
    redirect: "manual",
    headers: headersFor(target, scope),
    signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
  });
  if (!redirectStatuses.has(response.status)) return response;
  await response.body?.cancel();
  const location = response.headers.get("location");
  if (location === null) throw fetchFailed(target, `HTTP ${response.status} without a Location`);
  if (redirectsLeft === 0) throw fetchFailed(target, `more than ${maximumRedirects} redirects`);
  const next = new URL(location, target);
  if (!isReadableRegistryUrl(next)) {
    throw fetchFailed(
      target,
      `redirected to ${next.origin}, which is neither https nor a loopback host`,
      response.status,
    );
  }
  if (new URL(target).protocol === "https:" && next.protocol !== "https:") {
    throw fetchFailed(
      target,
      `redirected from https to ${next.origin}, a downgrade`,
      response.status,
    );
  }
  const nextScope = scope !== undefined && next.origin === scope.origin ? scope : undefined;
  return fetchFollowingSafeRedirects(next.href, fetchImpl, nextScope, redirectsLeft - 1);
}

/** Options of {@link urlTransport}. */
export interface UrlTransportOptions {
  /**
   * Headers sent only to the origin (scheme, host and port) of `base`. A redirect to another
   * origin drops them for the rest of the chain, even if a later hop returns to `base`'s origin.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The base as messages and `location` show it, such as a URL still holding `${VAR}`
   * placeholders when `base` is its expansion. Defaults to `base`.
   */
  readonly displayBase?: string;
}

function redactor(
  base: string,
  options: UrlTransportOptions | undefined,
): (text: string) => string {
  const replacements: [string, string][] = Object.values(options?.headers ?? {})
    .filter((value) => value !== "")
    .map((value) => [value, "[redacted]"]);
  if (options?.displayBase !== undefined && options.displayBase !== base) {
    replacements.unshift([base, options.displayBase]);
  }
  return (text) =>
    replacements.reduce((current, [secret, shown]) => current.replaceAll(secret, shown), text);
}

function redactedError(error: RegistryError, redact: (text: string) => string): RegistryError {
  const data =
    error.data.path === undefined ? error.data : { ...error.data, path: redact(error.data.path) };
  return new RegistryError(error.code, redact(error.message), redact(error.fix), data);
}

async function readResponse(url: string, response: Response): Promise<string | undefined> {
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw fetchFailed(url, `HTTP ${response.status}`, response.status);
  }
  return normalizeLineEndings(await response.text());
}

/**
 * A transport over a Registry served as static files under `base`, read with `fetchImpl` (native
 * `fetch` unless a test injects one). A 404 is a missing file; any other failure is
 * `REGISTRY_FETCH_FAILED`, whose message never holds a header value or the expanded `base`.
 */
export function urlTransport(
  base: string,
  fetchImpl: typeof fetch,
  options?: UrlTransportOptions,
): RegistryTransport {
  const scope =
    options?.headers === undefined
      ? undefined
      : { origin: new URL(base).origin, headers: options.headers };
  const redact = redactor(base, options);
  const location = options?.displayBase ?? base;
  return {
    location,
    async read(path) {
      assertSafeRelativePath(path, `Registry at ${location}`, location);
      const url = `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
      try {
        return await readResponse(url, await fetchFollowingSafeRedirects(url, fetchImpl, scope));
      } catch (error) {
        const failure =
          error instanceof RegistryError
            ? error
            : fetchFailed(url, error instanceof Error ? error.message : String(error));
        throw redactedError(failure, redact);
      }
    },
  };
}
