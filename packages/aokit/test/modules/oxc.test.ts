import { describe, expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import oxc from "../../../../registry-src/oxc/module.ts";
import { buildSelection } from "./support/index.ts";

const manifest = parseManifest(oxc);

async function build(layout: "single" | "monorepo") {
  const built = await buildSelection(["oxc"], layout);
  if (!built.ok) throw new Error(built.error.message);
  return built;
}

function parsed(text: string | Uint8Array | undefined): unknown {
  return JSON.parse(String(text));
}

describe("oxc", () => {
  test("single writes both configs at the root with pinned deps and type-aware lint", async () => {
    const built = await build("single");
    expect(built.plan.vfs.paths()).toEqual([
      ".oxfmtrc.json",
      ".oxlintrc.json",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
    ]);
    expect(parsed(built.plan.vfs.read("package.json"))).toMatchObject({
      scripts: {
        format: "oxfmt",
        lint: 'oxlint --type-aware --ignore-pattern "**/node_modules/**" -c ./.oxlintrc.json',
      },
      devDependencies: { oxfmt: "0.75.0", oxlint: "1.90.0", "oxlint-tsgolint": "^7.0.2006" },
    });
    expect(built.lockfile.deps["oxlint"]).toMatchObject({ pinned: true });
    expect(built.lockfile.deps["oxfmt"]).toMatchObject({ pinned: true });
    expect(built.lockfile.deps["oxlint-tsgolint"]).not.toMatchObject({ pinned: true });
  });

  test("monorepo keeps the Oxfmt config at the root so it governs every package", async () => {
    const built = await build("monorepo");
    expect(built.plan.vfs.paths()).toEqual([
      ".oxfmtrc.json",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "packages/config/.oxlintrc.json",
    ]);
    expect(parsed(built.plan.vfs.read("package.json"))).toMatchObject({
      scripts: {
        lint: 'oxlint --type-aware --ignore-pattern "**/node_modules/**" -c packages/config/.oxlintrc.json',
      },
    });
  });

  test("appends the agents Region", async () => {
    const built = await build("single");
    expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("aokit:begin oxc:agents");
  });

  test("declares lint.ignores as a json point and conflicts with eslint-prettier", () => {
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.conflicts).toEqual(["eslint-prettier"]);
    expect(manifest.extensionPoints).toEqual([
      {
        name: "lint.ignores",
        version: "1.0.0",
        target: "config",
        kind: "json",
        anchor: "/ignorePatterns",
        file: ".oxlintrc.json",
      },
    ]);
  });
});
