import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { join } from "node:path";
import { type MigrationFn, parseManifest } from "@aokit/module";
import { Vfs } from "../../src/engine/index.ts";
import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, lockfileOf, vfsOf } from "../merge/harness.ts";
import { jsonAt } from "../helpers/cli-json.ts";
import tailwind4Source from "../../../../registry-src/tailwind4/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const tailwind4 = parseManifest(tailwind4Source);
const migrationPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "registry-src",
  "tailwind4",
  "migrations",
  "remove-tailwind-provider.after.ts",
);

function isMigration(value: unknown): value is MigrationFn {
  return typeof value === "function";
}

async function loadMigration(): Promise<MigrationFn> {
  const loaded: unknown = await import(migrationPath);
  const exported = jsonAt(loaded, "default");
  if (!isMigration(exported)) throw new Error("the Migration has no default function");
  return exported;
}

const stockProvider = `import type { PropsWithChildren } from "react";

import.meta.glob("./styles.css", { eager: true });

export function TailwindProvider({ children }: PropsWithChildren) {
  return children;
}
`;

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function runMigration(vfs: Vfs): Promise<void> {
  const migrate = await loadMigration();
  migrate({
    vfs: {
      read: (path) => {
        const content = vfs.read(path);
        return typeof content === "string" ? content : undefined;
      },
      write: (path, content) => vfs.write(path, content),
      delete: (path) => vfs.delete(path),
      list: (prefix = "") => vfs.paths().filter((path) => path.startsWith(prefix)),
    },
    answers: {},
    context: { now: new Date(0), random: () => 0.5 },
  });
}

describe("tailwind4", () => {
  test.each(["single", "monorepo"] as const)(
    "on vite-react imports the stylesheet once and writes the PostCSS config (%s)",
    async (layout) => {
      const { plan } = await build(layout, ["vite-react", "tailwind4"]);
      const directory = layout === "single" ? "" : "apps/web/";
      const main = String(plan.vfs.read(`${directory}src/main.tsx`));
      expect(occurrences(main, 'import "./styles.css";')).toBe(1);
      const styles = String(plan.vfs.read(`${directory}src/styles.css`));
      expect(occurrences(styles, '@import "tailwindcss";')).toBe(1);
      expect(String(plan.vfs.read(`${directory}postcss.config.mjs`))).toContain(
        '"@tailwindcss/postcss"',
      );
      expect(plan.vfs.has(`${directory}src/tailwind-provider.tsx`)).toBe(false);
      const config = String(plan.vfs.read(`${directory}vite.config.ts`));
      expect(config).not.toContain("@tailwindcss/vite");
      expect(String(plan.vfs.read(`${directory}src/providers.tsx`))).not.toContain(
        "TailwindProvider",
      );
    },
  );

  test("places tailwindcss, @tailwindcss/postcss and postcss per Target", async () => {
    const single = await build("single", ["vite-react", "tailwind4"]);
    const manifest = packageSchema.parse(JSON.parse(String(single.plan.vfs.read("package.json"))));
    expect(manifest.dependencies).toMatchObject({ tailwindcss: "^4.3.4" });
    expect(manifest.devDependencies).toMatchObject({
      "@tailwindcss/postcss": "^4.3.4",
      postcss: "^8.5.32",
    });
    const monorepo = await build("monorepo", ["vite-react", "tailwind4"]);
    const web = packageSchema.parse(
      JSON.parse(String(monorepo.plan.vfs.read("apps/web/package.json"))),
    );
    expect(web.dependencies).toMatchObject({ tailwindcss: "catalog:" });
    expect(web.devDependencies).toMatchObject({
      "@tailwindcss/postcss": "catalog:",
      postcss: "catalog:",
    });
  });

  test("appends the agents Region", async () => {
    const { plan } = await build("single", ["vite-react", "tailwind4"]);
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin tailwind4:agents");
  });

  test("fails without a web base, naming the missing requirement", async () => {
    const built = await buildSelection(["tailwind4"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web");
  });

  test("declares styles.theme as a region point and requires web.styles", () => {
    expect(tailwind4.version).toBe("2.0.0");
    expect(tailwind4.requires).toEqual(["web", "ext:web.styles@^1"]);
    expect(tailwind4.extensionPoints).toEqual([
      {
        name: "styles.theme",
        version: "1.0.0",
        target: "web",
        kind: "region",
        anchor: "theme",
        file: "src/styles.css",
      },
    ]);
    expect(tailwind4.migrations).toEqual([
      {
        from: ">=1.0.0 <2.0.0",
        to: "2.0.0",
        stage: "after",
        script: "migrations/remove-tailwind-provider.after.js",
      },
    ]);
  });
});

describe("tailwind4 Migration", () => {
  test.each(["src/tailwind-provider.tsx", "apps/web/src/tailwind-provider.tsx"])(
    "removes the untouched generated provider at %s",
    async (path) => {
      const vfs = new Vfs();
      vfs.write(path, stockProvider);
      vfs.write("src/other.ts", "export {};\n");
      await runMigration(vfs);
      expect(vfs.has(path)).toBe(false);
      expect(vfs.has("src/other.ts")).toBe(true);
    },
  );

  test("keeps a provider the user edited instead of deleting it silently", async () => {
    const edited = `${stockProvider}\nexport const theme = "dark";\n`;
    const vfs = new Vfs();
    vfs.write("apps/web/src/tailwind-provider.tsx", edited);
    await runMigration(vfs);
    expect(vfs.read("apps/web/src/tailwind-provider.tsx")).toBe(edited);
  });

  test("tolerates formatter whitespace changes in the generated provider", async () => {
    const vfs = new Vfs();
    vfs.write("src/tailwind-provider.tsx", stockProvider.replaceAll("\n\n", "\n"));
    await runMigration(vfs);
    expect(vfs.has("src/tailwind-provider.tsx")).toBe(false);
  });
});

describe("tailwind4 2.0.0 update", () => {
  const providerPath = "src/tailwind-provider.tsx";

  async function update(user: string) {
    const base = { [providerPath]: stockProvider };
    return mergeProject({
      base: vfsOf(base),
      next: builtOf({}),
      readUser: (path) => Promise.resolve(path === providerPath ? user : undefined),
      lockfile: lockfileOf(base),
      merger: createMerger(),
      driftOf,
    });
  }

  test("an edited provider survives the update with a warning", async () => {
    const edited = `${stockProvider}\nexport const theme = "dark";\n`;
    const result = await update(edited);
    expect(result.plan.changes).toEqual([]);
    expect(result.vfs.read(providerPath)).toBe(edited);
    expect(result.warnings.join("\n")).toContain(providerPath);
  });

  test("an untouched provider is deleted by the update", async () => {
    const result = await update(stockProvider);
    expect(result.plan.changes.map((change) => [change.type, change.path])).toEqual([
      ["delete", providerPath],
    ]);
  });
});
