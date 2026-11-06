import { describe, expect, test } from "bun:test";
import { format } from "oxfmt";
import oxfmtManifest from "oxfmt/package.json" with { type: "json" };
import { Vfs } from "../../src/engine/index.ts";
import { matchesIgnore } from "../../src/format/config.ts";
import { oxfmtExtensions, oxfmtFilenames, oxfmtSupports } from "../../src/format/supported.ts";
import { createOxfmtFormatter } from "../../src/format/index.ts";
import { catalogSchema } from "@aokit/module";

const pinnedOxfmtVersion = "0.75.0";
const upgradeHint = `Oxfmt changed from ${pinnedOxfmtVersion} to ${oxfmtManifest.version}: re-audit src/format/supported.ts against the new version and update this test's pin.`;

const unsupportedProbes = [
  "a.txt",
  "a.sh",
  "a.png",
  "a.xml",
  "a.svg",
  "a.ini",
  "A.JSON",
  "a.TS",
  "Dockerfile",
  ".gitignore",
  ".env.example",
  "bun.lock",
  "composer.lock",
];

async function oxfmtRejectsAsUnsupported(path: string): Promise<boolean> {
  const result = await format(path, "a", {});
  return result.errors.some((error) => error.message.startsWith("Unsupported file type"));
}

describe("oxfmtSupports", () => {
  test("the allowlist is pinned to the installed Oxfmt version", async () => {
    expect(oxfmtManifest.version, upgradeHint).toBe(pinnedOxfmtVersion);

    const allowlisted = [...oxfmtExtensions.map((extension) => `a${extension}`), ...oxfmtFilenames];
    const rejected = (
      await Promise.all(
        allowlisted.map(async (path) => ((await oxfmtRejectsAsUnsupported(path)) ? path : "")),
      )
    ).filter((path) => path !== "");
    expect(rejected, `${upgradeHint} Allowlisted but rejected by Oxfmt.`).toEqual([]);

    const accepted = (
      await Promise.all(
        unsupportedProbes.map(async (path) =>
          (await oxfmtRejectsAsUnsupported(path)) ? "" : path,
        ),
      )
    ).filter((path) => path !== "");
    expect(accepted, `${upgradeHint} Now formatted by Oxfmt but not allowlisted.`).toEqual([]);

    for (const path of unsupportedProbes) {
      expect(oxfmtSupports(path)).toBe(false);
    }
  });

  test("matches by extension at any depth and by known filename", () => {
    expect(oxfmtSupports("src/deep/a.ts")).toBe(true);
    expect(oxfmtSupports("package.json")).toBe(true);
    expect(oxfmtSupports("pkg/.prettierrc")).toBe(true);
    expect(oxfmtSupports("Dockerfile")).toBe(false);
  });
});

describe("formatter allowlist", () => {
  const catalog = catalogSchema.parse({
    dependencies: { oxfmt: oxfmtManifest.version },
    pinGroups: { oxc: ["oxfmt"] },
  });

  test("a file outside the allowlist is returned byte for byte", async () => {
    const vfs = Vfs.empty();
    vfs.write("notes.txt", "a   b\n");
    vfs.write("broken.sh", "if [\n");
    const formatted = await createOxfmtFormatter({ catalog }).format(vfs);
    expect(formatted.read("notes.txt")).toBe("a   b\n");
    expect(formatted.read("broken.sh")).toBe("if [\n");
  });
});

describe("matchesIgnore", () => {
  test("the last match wins and ! re-includes", () => {
    const patterns = ["generated", "!generated/keep.ts"];
    expect(matchesIgnore("generated/keep.ts", patterns)).toBe(false);
    expect(matchesIgnore("generated/other.ts", patterns)).toBe(true);
    expect(matchesIgnore("src/a.ts", patterns)).toBe(false);
  });

  test("a later ignore overrides an earlier re-include", () => {
    const patterns = ["generated", "!generated/keep.ts", "generated/keep.ts"];
    expect(matchesIgnore("generated/keep.ts", patterns)).toBe(true);
  });

  test("a negation before any match changes nothing", () => {
    expect(matchesIgnore("generated/keep.ts", ["!generated/keep.ts", "generated"])).toBe(true);
  });

  test("the formatter formats the re-included file and skips the rest", async () => {
    const catalog = catalogSchema.parse({
      dependencies: { oxfmt: oxfmtManifest.version },
      pinGroups: { oxc: ["oxfmt"] },
    });
    const vfs = Vfs.empty();
    vfs.write(
      ".oxfmtrc.json",
      JSON.stringify({ ignorePatterns: ["generated", "!generated/keep.ts"] }),
    );
    vfs.write("generated/keep.ts", "const   a=1\n");
    vfs.write("generated/other.ts", "const   b=1\n");
    const formatted = await createOxfmtFormatter({ catalog }).format(vfs);
    expect(formatted.read("generated/keep.ts")).toBe("const a = 1;\n");
    expect(formatted.read("generated/other.ts")).toBe("const   b=1\n");
  });
});
