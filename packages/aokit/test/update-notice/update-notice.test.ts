import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minCliVersionFix } from "../../src/cli/min-cli-version.ts";
import {
  maybeNotifyUpdate,
  refreshLatestVersion,
  type UpdateNoticeInput,
} from "../../src/cli/update-notice/index.ts";

const now = 1_800_000_000_000;
const hour = 60 * 60 * 1000;
let cacheHome: string;
let stderrText: string;
let fetchCalls: number;

function cacheFile(): string {
  return join(cacheHome, "aokit", "update-check.json");
}

function seedCache(cache: Record<string, unknown>): void {
  mkdirSync(join(cacheHome, "aokit"), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(cache));
}

function input(overrides: Partial<UpdateNoticeInput> = {}): UpdateNoticeInput {
  return {
    version: "1.0.0",
    env: { XDG_CACHE_HOME: cacheHome },
    isTTY: true,
    json: false,
    quiet: false,
    interactive: true,
    now: () => now,
    fetch: () => {
      fetchCalls += 1;
      return new Promise<Response>(() => undefined);
    },
    stderr: (text) => {
      stderrText += text;
    },
    ...overrides,
  };
}

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "aokit-update-"));
  stderrText = "";
  fetchCalls = 0;
});

afterEach(() => {
  rmSync(cacheHome, { recursive: true, force: true });
});

describe("update notice", () => {
  test("prints one notice naming both versions when the cached latest is newer", () => {
    seedCache({ latest: "2.0.0", checkedAt: now, notifiedAt: now - 25 * hour });
    maybeNotifyUpdate(input());
    expect(stderrText).toContain("1.0.0");
    expect(stderrText).toContain("2.0.0");
    expect(stderrText.trimEnd().split("\n")).toHaveLength(1);
  });

  test("prints at most once per 24 hours", () => {
    seedCache({ latest: "2.0.0", checkedAt: now });
    maybeNotifyUpdate(input());
    maybeNotifyUpdate(input({ now: () => now + 23 * hour }));
    expect(stderrText.match(/Update available/g)).toHaveLength(1);
    maybeNotifyUpdate(input({ now: () => now + 25 * hour }));
    expect(stderrText.match(/Update available/g)).toHaveLength(2);
  });

  test("prints nothing when the cached latest is not newer", () => {
    seedCache({ latest: "1.0.0", checkedAt: now });
    maybeNotifyUpdate(input());
    expect(stderrText).toBe("");
  });

  const suppressions: [string, Partial<UpdateNoticeInput>][] = [
    ["--json", { json: true }],
    ["--quiet", { quiet: true }],
    ["CI=1", { env: { CI: "1" } }],
    ["AOKIT_NO_UPDATE_NOTIFIER=1", { env: { AOKIT_NO_UPDATE_NOTIFIER: "1" } }],
    ["a non-TTY", { isTTY: false }],
    ["non-interactive mode", { interactive: false }],
  ];
  for (const [name, overrides] of suppressions) {
    test(`prints nothing and never fetches with ${name}`, () => {
      seedCache({ latest: "2.0.0" });
      maybeNotifyUpdate(
        input({ ...overrides, env: { XDG_CACHE_HOME: cacheHome, ...overrides.env } }),
      );
      expect(stderrText).toBe("");
      expect(fetchCalls).toBe(0);
    });
  }

  test("an unreachable registry neither throws nor prints", async () => {
    let attempted = false;
    maybeNotifyUpdate(
      input({
        fetch: () => {
          attempted = true;
          return Promise.reject(new Error("offline"));
        },
      }),
    );
    expect(attempted).toBe(true);
    await Bun.sleep(5);
    expect(stderrText).toBe("");
  });

  test("a pending request does not block the call", () => {
    maybeNotifyUpdate(input());
    expect(fetchCalls).toBe(1);
  });

  test("a stale cache starts the injected refresh once, records the attempt and never fetches in process", () => {
    let started = 0;
    maybeNotifyUpdate(
      input({
        refresh: () => {
          started += 1;
        },
      }),
    );
    expect(started).toBe(1);
    expect(fetchCalls).toBe(0);
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toEqual({ checkedAt: now });
    maybeNotifyUpdate(
      input({
        refresh: () => {
          started += 1;
        },
      }),
    );
    expect(started).toBe(1);
  });

  test("a fresh cache does not trigger a refresh", () => {
    seedCache({ latest: "1.0.0", checkedAt: now - hour });
    maybeNotifyUpdate(input());
    expect(fetchCalls).toBe(0);
  });

  test("refresh stores the latest version from the npm registry", async () => {
    let requested = "";
    await refreshLatestVersion(
      input({
        fetch: (url) => {
          requested = url;
          return Promise.resolve(Response.json({ version: "3.1.4" }));
        },
      }),
    );
    expect(requested).toBe("https://registry.npmjs.org/aokit/latest");
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toEqual({ latest: "3.1.4" });
  });

  test("a failed refresh leaves the cache untouched", async () => {
    seedCache({ latest: "2.0.0", checkedAt: now - 30 * hour });
    await refreshLatestVersion(input({ fetch: () => Promise.reject(new Error("offline")) }));
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toEqual({
      latest: "2.0.0",
      checkedAt: now - 30 * hour,
    });
  });
});

describe("minCliVersionFix", () => {
  test("names bunx and the releases page", () => {
    const fix = minCliVersionFix("99.0.0");
    expect(fix).toContain("bunx aokit@99.0.0");
    expect(fix).toContain("https://github.com/AndryOre/aokit/releases");
  });
});
