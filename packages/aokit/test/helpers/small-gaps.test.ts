import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUserConfig } from "../../src/config/user-config.ts";
import { hashFileBytes, hashTrackedFile } from "../../src/drift/hash.ts";
import { editDefineConfig } from "../../src/edit/config.ts";
import { initMcpClient } from "../../src/mcp/init/init.ts";
import { normalizeUserContent } from "../../src/merge/content.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aokit-small-gaps-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("normalizeUserContent", () => {
  test("keeps undefined, normalizes line endings of text and UTF-8 bytes", () => {
    expect(normalizeUserContent(undefined)).toBeUndefined();
    expect(normalizeUserContent("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeUserContent(new TextEncoder().encode("a\r\nb"))).toBe("a\nb");
  });

  test("keeps binary bytes and invalid UTF-8 as bytes", () => {
    const withNul = new Uint8Array([1, 0, 2]);
    const invalid = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(normalizeUserContent(withNul)).toBe(withNul);
    expect(normalizeUserContent(invalid)).toBe(invalid);
  });
});

describe("hashing", () => {
  test("binary bytes hash without LF normalization", () => {
    const binary = new Uint8Array([0, 13, 10]);
    expect(hashFileBytes(binary)).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(hashFileBytes(binary)).not.toBe(hashFileBytes(new Uint8Array([0, 10])));
  });

  test("a Region file with malformed markers hashes its bytes", () => {
    const malformed = new TextEncoder().encode("<!-- aokit:begin a -->\nnever closed\n");
    expect(hashTrackedFile("AGENTS.md", malformed)).toBe(hashFileBytes(malformed));
  });
});

describe("editDefineConfig", () => {
  test("rejects a config that is not an `export default defineConfig(...)` call", () => {
    expect(() =>
      editDefineConfig("vite.config.ts", "export default {};\n", () => undefined),
    ).toThrow(/must contain "export default defineConfig/);
  });

  test("rejects a call whose first argument is not an object literal", () => {
    expect(() =>
      editDefineConfig("vite.config.ts", "export default defineConfig();\n", () => undefined),
    ).toThrow(/must be an object literal/);
  });
});

describe("user config", () => {
  test("an unreadable config is an IO_ERROR that names the file", async () => {
    mkdirSync(join(root, "aokit", "config.json"), { recursive: true });
    const failure = await loadUserConfig({ XDG_CONFIG_HOME: root, HOME: root }).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "IO_ERROR" });
  });
});

describe("initMcpClient", () => {
  test("a config path that cannot be read as a file fails instead of being replaced", async () => {
    mkdirSync(join(root, ".mcp.json"));
    const failure = await initMcpClient({
      client: "claude",
      directory: root,
      print: false,
      dryRun: true,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
  });
});
