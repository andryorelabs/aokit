import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cliVersion } from "../../src/cli/version.ts";
import { Vfs } from "../../src/engine/index.ts";
import { readLocalRegistry } from "../../src/registry/index.ts";

const repositoryRoot = join(import.meta.dir, "..", "..", "..", "..");
const sourceRoot = join(repositoryRoot, "registry-src");

function readJson(path: string): Record<string, unknown> & { release: unknown } {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path} is not an object`);
  return {
    ...Object.fromEntries(Object.entries(parsed)),
    release: "release" in parsed ? parsed.release : undefined,
  };
}

function openRegistry() {
  return readLocalRegistry(join(repositoryRoot, "registry"), { cliVersion });
}

describe("Release 2026.11.1", () => {
  test("the index keeps both Releases and the old and new Module versions", async () => {
    const registry = await openRegistry();
    for (const release of ["2026.11.0", "2026.11.1"]) {
      expect(registry.releases()).toContain(release);
    }
    for (const [name, version] of [
      ["vite-react", "1.0.0"],
      ["vite-react", "1.1.0"],
      ["oxc", "1.0.0"],
      ["oxc", "1.0.1"],
    ] as const) {
      expect(registry.version(name, version)).toBeDefined();
    }
  });

  test("the Catalog equals 2026.11.0's apart from the release name", () => {
    const previous = readJson(join(sourceRoot, "catalog", "2026.11.0.json"));
    const next = readJson(join(sourceRoot, "catalog", "2026.11.1.json"));
    expect({ ...next, release: previous.release }).toEqual(previous);
    expect(next.release).toBe("2026.11.1");
  });

  test("vite-react 1.1.0 declares the after Migration and the router Extension point file", async () => {
    const registry = await openRegistry();
    const manifest = registry.version("vite-react", "1.1.0")?.manifest;
    expect(manifest?.migrations).toEqual([
      {
        from: ">=1.0.0 <1.1.0",
        to: "1.1.0",
        stage: "after",
        script: "migrations/routes-to-router.after.js",
      },
    ]);
    const routes = manifest?.extensionPoints.find((point) => point.name === "web.routes");
    expect(routes?.file).toBe("src/router.tsx");
  });

  test("the Migration rewrites ./routes imports in the web Target only", async () => {
    const registry = await openRegistry();
    const script = registry
      .version("vite-react", "1.1.0")
      ?.migrationScript("migrations/routes-to-router.after.js");
    if (script === undefined) throw new Error("missing script");
    const loaded: unknown = await import(script);
    if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
      throw new Error("script has no default export");
    }
    const exported: unknown = loaded.default;
    if (typeof exported !== "function") throw new Error("default export is not a function");
    const vfs = new Vfs();
    vfs.write("apps/web/src/router.tsx", "export const routes = [];\n");
    vfs.write("apps/web/src/app.tsx", 'import { routes } from "./routes";\n');
    vfs.write("apps/web/src/lazy.ts", "const mod = import('./routes');\n");
    vfs.write("apps/api/src/app.ts", 'import { routes } from "./routes";\n');
    const adapter = {
      read: (path: string) => {
        const content = vfs.read(path);
        return typeof content === "string" ? content : undefined;
      },
      write: (path: string, content: string) => vfs.write(path, content),
      delete: (path: string) => vfs.delete(path),
      list: (prefix = "") => vfs.paths().filter((path) => path.startsWith(prefix)),
    };
    Reflect.apply(exported, undefined, [
      { vfs: adapter, answers: {}, context: { now: new Date(0), random: () => 0 } },
    ]);
    expect(vfs.read("apps/web/src/app.tsx")).toBe('import { routes } from "./router";\n');
    expect(vfs.read("apps/web/src/lazy.ts")).toBe("const mod = import('./router');\n");
    expect(vfs.read("apps/api/src/app.ts")).toBe('import { routes } from "./routes";\n');
  });
});

describe("Release 2026.12.0", () => {
  test("the index keeps every earlier Release and adds 2026.12.0", async () => {
    const registry = await openRegistry();
    for (const release of ["2026.11.0", "2026.11.1", "2026.11.2", "2026.12.0"]) {
      expect(registry.releases()).toContain(release);
    }
  });

  test("the Catalog extends 2026.11.2, keeps its pin groups and maps every Module", () => {
    const previous = readJson(join(sourceRoot, "catalog", "2026.11.2.json"));
    const next = readJson(join(sourceRoot, "catalog", "2026.12.0.json"));
    expect(next.release).toBe("2026.12.0");
    expect(next["pinGroups"]).toMatchObject(
      z.record(z.string(), z.array(z.string())).parse(previous["pinGroups"]),
    );
    const previousDependencies = z.record(z.string(), z.string()).parse(previous["dependencies"]);
    const nextDependencies = z.record(z.string(), z.string()).parse(next["dependencies"]);
    expect(nextDependencies).toMatchObject(previousDependencies);
    const names = Object.keys(nextDependencies);
    expect(names).toEqual(names.toSorted());
    expect(z.record(z.string(), z.string()).parse(next["modules"])["tailwind4"]).toBe("2.0.0");
  });

  test("tailwind4 2.0.0 ships and 1.x stays published", async () => {
    const registry = await openRegistry();
    expect(registry.version("tailwind4", "2.0.0")).toBeDefined();
    expect(registry.version("tailwind4", "1.0.0")).toBeDefined();
  });

  test("no Catalog fragment is left in registry-src", () => {
    const leftovers = readdirSync(sourceRoot, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(join(sourceRoot, entry.name, "catalog.json")),
    );
    expect(leftovers).toEqual([]);
  });
});
