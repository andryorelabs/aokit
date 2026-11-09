import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineModule, parseManifest } from "@aokit/module";
import type { EngineModule } from "../../src/engine/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";
import { buildSelection, draftCatalog } from "./support/index.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const base = ["next", "next-intl"] as const;

async function build(layout: "single" | "monorepo", names: readonly string[] = base) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

async function loadModule(name: string): Promise<EngineModule> {
  const loaded: unknown = await import(join(sourceRoot, name, "module.ts"));
  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Error(`Module ${name} has no default export`);
  }
  return {
    manifest: parseManifest(loaded.default),
    readFile: (from) => readFileSync(join(sourceRoot, name, from), "utf8"),
  };
}

async function buildWithFixture(proxyContent: string) {
  const fixture: EngineModule = {
    manifest: parseManifest(
      defineModule({
        name: "proxy-fixture",
        version: "1.0.0",
        requires: ["web:app-router"],
        files: [{ from: "proxy.ts", to: "src/proxy.ts", target: "web", ownership: "managed" }],
      }),
    ),
    readFile: () => proxyContent,
  };
  const real = await Promise.all(["next", "next-intl"].map((name) => loadModule(name)));
  const available: EngineModule[] = [fixture, ...real];
  return buildProject({
    selection: ["next", "next-intl", "proxy-fixture"],
    available,
    answers: {},
    layout: "single",
    catalog: draftCatalog(),
    context: { now: new Date(0), random: () => 0.5, env: {} },
    registry: {
      name: "official",
      source: "registry",
      release: draftCatalog().release ?? "0.0.0",
      minCliVersion: "0.1.0",
    },
  });
}

describe("next-intl", () => {
  test("the client provider graph never reaches a server-only import", async () => {
    const vfs = await build("single");
    const serverOnly = /from "(next\/headers|next-intl\/server)"/;
    const visited = new Set<string>();
    const queue = ["src/i18n/provider.tsx"];
    while (queue.length > 0) {
      const path = queue.pop() ?? "";
      if (visited.has(path)) continue;
      visited.add(path);
      const source = String(vfs.read(path));
      expect(source).not.toMatch(serverOnly);
      for (const match of source.matchAll(/from "\.\/([\w-]+)"/g)) {
        queue.push(`src/i18n/${match[1]}.ts`);
      }
    }
    expect([...visited]).toContain("src/i18n/messages.ts");
  });

  test.each(["single", "monorepo"] as const)(
    "writes its i18n files and replaces the proxy (%s)",
    async (layout) => {
      const vfs = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      for (const path of [
        "src/i18n/routing.ts",
        "src/i18n/messages.ts",
        "src/i18n/request.ts",
        "src/i18n/provider.tsx",
        "src/messages/en.json",
      ]) {
        expect(vfs.has(`${directory}${path}`)).toBe(true);
      }
      expect(String(vfs.read(`${directory}src/proxy.ts`))).toContain("accept-language");
    },
  );

  test.each(["single", "monorepo"] as const)(
    "contributes the plugin and the provider (%s)",
    async (layout) => {
      const vfs = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      const config = String(vfs.read(`${directory}next.config.ts`));
      expect(config).toContain('import createNextIntlPlugin from "next-intl/plugin"');
      expect(config).toContain('createNextIntlPlugin("./src/i18n/request.ts")');
      const providers = String(vfs.read(`${directory}src/providers.tsx`));
      expect(providers).toContain("IntlProvider");
      expect(providers).toContain("./i18n/provider");
    },
  );

  test("places its dependency per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ "next-intl": "^4.14.9" });
    const web = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("apps/web/package.json"))),
    );
    expect(web.dependencies).toMatchObject({ "next-intl": "catalog:" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin next-intl:agents",
    );
  });

  test("only next-intl writes src/proxy.ts when another Module also writes it", async () => {
    const built = await buildWithFixture("export const fixtureProxy = true;\n");
    if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
    const proxy = String(built.plan.vfs.read("src/proxy.ts"));
    expect(proxy).toContain("accept-language");
    expect(proxy).not.toContain("fixtureProxy");
  });

  test("fails without a Next base, naming the missing requirement", async () => {
    const built = await buildSelection(["next-intl"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("next.plugins");
  });

  test("fails on a base without the Next Extension points", async () => {
    const built = await buildSelection(["vite-react", "next-intl"], "single");
    expect(built.ok).toBe(false);
  });
});
