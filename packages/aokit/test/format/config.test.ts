import { describe, expect, test } from "bun:test";
import { Vfs } from "../../src/engine/index.ts";
import { matchesIgnore, optionsFor, readProjectConfigs } from "../../src/format/config.ts";
import { FormatError } from "../../src/format/errors.ts";

function vfsWith(files: Record<string, string | Uint8Array>): Vfs {
  const vfs = Vfs.empty();
  for (const [path, content] of Object.entries(files)) {
    vfs.write(path, content);
  }
  return vfs;
}

describe("readProjectConfigs", () => {
  test("reads configs deepest directory first and skips binary and duplicate configs", () => {
    const configs = readProjectConfigs(
      vfsWith({
        ".oxfmtrc.json": '{ "semi": false, }',
        "apps/web/.oxfmtrc.json": '{ "semi": true }',
        "apps/web/.oxfmtrc.jsonc": '{ "semi": false }',
        "apps/bin/.oxfmtrc.json": new Uint8Array([1, 2, 3]),
        "README.md": "# docs",
      }),
    );
    expect(configs.map((entry) => entry.directory)).toEqual(["apps/web", "."]);
    expect(configs[0]?.config).toEqual({ semi: true });
  });

  test("rejects invalid JSON with a FormatError that names the file", () => {
    expect(() => readProjectConfigs(vfsWith({ ".oxfmtrc.json": "{ nope" }))).toThrow(FormatError);
  });

  test("rejects a config that is not a JSON object", () => {
    expect(() => readProjectConfigs(vfsWith({ ".oxfmtrc.json": "[1]" }))).toThrow(
      /expected a JSON object/,
    );
  });
});

describe("matchesIgnore", () => {
  test("applies patterns in order, last match wins, and `!` re-includes", () => {
    expect(matchesIgnore("dist/a.js", ["dist"])).toBe(true);
    expect(matchesIgnore("src/dist/a.js", ["dist/"])).toBe(true);
    expect(matchesIgnore("dist/keep.js", ["dist", "!dist/keep.js"])).toBe(false);
    expect(matchesIgnore("src/a.js", ["", "/lib"])).toBe(false);
    expect(matchesIgnore("lib/a.js", ["/lib"])).toBe(true);
  });
});

describe("optionsFor", () => {
  const configs = readProjectConfigs(
    vfsWith({
      ".oxfmtrc.json": JSON.stringify({
        $schema: "x",
        semi: false,
        ignorePatterns: ["generated"],
        overrides: [
          { files: ["*.test.ts"], options: { semi: true } },
          { files: ["*.spec.ts"], excludeFiles: ["skip.spec.ts"], options: { semi: true } },
        ],
      }),
      "apps/web/.oxfmtrc.json": JSON.stringify({ tabWidth: 4 }),
    }),
  );

  test("returns the nearest config options with matching overrides applied", () => {
    expect(optionsFor("a.ts", configs)).toEqual({ semi: false });
    expect(optionsFor("a.test.ts", configs)).toEqual({ semi: true });
    expect(optionsFor("skip.spec.ts", configs)).toEqual({ semi: false });
    expect(optionsFor("apps/web/a.ts", configs)).toEqual({ tabWidth: 4 });
  });

  test("returns undefined when the config ignores the file", () => {
    expect(optionsFor("generated/a.ts", configs)).toBeUndefined();
  });

  test("returns empty options when no config governs the path", () => {
    expect(optionsFor("a.ts", [])).toEqual({});
  });
});
