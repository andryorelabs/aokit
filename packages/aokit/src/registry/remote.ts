import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RegistryError } from "./errors.ts";
import { normalizeLineEndings } from "./integrity.ts";

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

/**
 * A transport over a Registry served as static files under `base`, read with `fetchImpl` (native
 * `fetch` unless a test injects one). A 404 is a missing file; any other failure is
 * `REGISTRY_FETCH_FAILED`.
 */
export function urlTransport(base: string, fetchImpl: typeof fetch): RegistryTransport {
  return {
    location: base,
    async read(path) {
      assertSafeRelativePath(path, `Registry at ${base}`, base);
      const url = `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
        });
      } catch (error) {
        throw fetchFailed(url, error instanceof Error ? error.message : String(error));
      }
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw fetchFailed(url, `HTTP ${response.status}`, response.status);
      }
      try {
        return normalizeLineEndings(await response.text());
      } catch (error) {
        throw fetchFailed(url, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
