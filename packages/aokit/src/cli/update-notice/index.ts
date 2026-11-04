import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { xdgCacheDir } from "../../xdg.ts";

const dayInMilliseconds = 24 * 60 * 60 * 1000;
const registryUrl = "https://registry.npmjs.org/aokit/latest";
const requestTimeoutMilliseconds = 3000;

/** The fetch signature the update check needs. */
export type UpdateFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface UpdateNoticeInput {
  readonly version: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly interactive: boolean;
  readonly now: () => number;
  readonly fetch: UpdateFetch;
  readonly stderr: (text: string) => void;
}

interface UpdateCache {
  readonly checkedAt?: number;
  readonly latest?: string;
  readonly notifiedAt?: number;
}

function cachePath(env: UpdateNoticeInput["env"]): string {
  return join(xdgCacheDir(env), "update-check.json");
}

function readCache(path: string): UpdateCache {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(path: string, cache: UpdateCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache)}\n`);
  } catch {
    return;
  }
}

function isDisabled(input: UpdateNoticeInput): boolean {
  const ci = input.env.CI;
  return (
    input.env.AOKIT_NO_UPDATE_NOTIFIER === "1" ||
    (ci !== undefined && ci !== "" && ci !== "0" && ci !== "false") ||
    !input.isTTY ||
    input.json ||
    input.quiet ||
    !input.interactive
  );
}

function isOlderThanADay(timestamp: unknown, now: number): boolean {
  return typeof timestamp !== "number" || now - timestamp >= dayInMilliseconds;
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+/.test(value);
}

/**
 * Asks the npm registry for the latest `aokit` version and stores it in the cache. Never throws:
 * an unreachable registry leaves the cache as it was.
 */
export async function refreshLatestVersion(input: UpdateNoticeInput): Promise<void> {
  const path = cachePath(input.env);
  try {
    const response = await input.fetch(registryUrl, {
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    if (!response.ok) {
      return;
    }
    const body: unknown = await response.json();
    const latest =
      typeof body === "object" && body !== null && "version" in body ? body.version : undefined;
    if (!isVersion(latest)) {
      return;
    }
    writeCache(path, { ...readCache(path), latest, checkedAt: input.now() });
  } catch {
    return;
  }
}

/**
 * Prints at most one update notice per 24 hours from the cached latest version and refreshes that
 * cache in the background. It never waits for the network.
 */
export function maybeNotifyUpdate(input: UpdateNoticeInput): void {
  if (isDisabled(input)) {
    return;
  }
  const path = cachePath(input.env);
  const cache = readCache(path);
  const now = input.now();
  if (
    isVersion(cache.latest) &&
    Bun.semver.order(cache.latest, input.version) > 0 &&
    isOlderThanADay(cache.notifiedAt, now)
  ) {
    input.stderr(
      `Update available: aokit ${input.version} -> ${cache.latest}. Run \`bunx aokit@latest\` or see https://github.com/AndryOre/aokit/releases\n`,
    );
    writeCache(path, { ...cache, notifiedAt: now });
  }
  if (isOlderThanADay(cache.checkedAt, now)) {
    void refreshLatestVersion(input);
  }
}
