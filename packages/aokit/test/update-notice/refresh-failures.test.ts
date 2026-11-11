import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maybeNotifyUpdate,
  refreshLatestVersion,
  type UpdateNoticeInput,
} from "../../src/cli/update-notice/index.ts";

const now = 1_800_000_000_000;
let cacheHome: string;

function input(overrides: Partial<UpdateNoticeInput> = {}): UpdateNoticeInput {
  return {
    version: "1.0.0",
    env: { XDG_CACHE_HOME: cacheHome },
    isTTY: true,
    json: false,
    quiet: false,
    interactive: true,
    now: () => now,
    fetch: () => new Promise<Response>(() => undefined),
    stderr: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "aokit-update-failures-"));
});

afterEach(() => {
  rmSync(cacheHome, { recursive: true, force: true });
});

describe("refreshLatestVersion", () => {
  test("a non-ok response leaves no cache behind", async () => {
    await refreshLatestVersion(
      input({ fetch: () => Promise.resolve(new Response("nope", { status: 503 })) }),
    );
    expect(() => readFileSync(join(cacheHome, "aokit", "update-check.json"), "utf8")).toThrow();
  });

  test.each([{ version: "latest" }, { version: 3 }, { name: "aokit" }, null])(
    "a body without a semver version %p leaves no cache behind",
    async (body) => {
      await refreshLatestVersion(input({ fetch: () => Promise.resolve(Response.json(body)) }));
      expect(() => readFileSync(join(cacheHome, "aokit", "update-check.json"), "utf8")).toThrow();
    },
  );
});

describe("maybeNotifyUpdate", () => {
  test("an unwritable cache directory never throws", () => {
    const blocker = join(cacheHome, "blocker");
    writeFileSync(blocker, "a file, not a directory");
    expect(() =>
      maybeNotifyUpdate(input({ env: { XDG_CACHE_HOME: blocker }, refresh: () => undefined })),
    ).not.toThrow();
  });
});
