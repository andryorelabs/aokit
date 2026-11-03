import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cliVersion } from "../../src/cli/version.ts";
import { Vfs } from "../../src/engine/index.ts";
import { readLocalRegistry } from "../../src/registry/index.ts";

const repositoryRoot = join(import.meta.dir, "..", "..", "..", "..");
const sourceRoot = join(repositoryRoot, "registry-src");

function readJson(path: string): { release: unknown } {
  return JSON.parse(readFileSync(path, "utf8"));
}

function openRegistry() {
  return readLocalRegistry(join(repositoryRoot, "registry"), { cliVersion });
}

describe("Release 2026.11.1", () => {
  test("the index keeps both Releases and the old and new Module versions", async () => {
    const registry = await openRegistry();
    expect(registry.releases()).toEqual(expect.arrayContaining(["2026.11.0", "2026.11.1"]));
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
    const migrate = (await import(script)).default;
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
    migrate({ vfs: adapter, answers: {}, context: { now: new Date(0), random: () => 0 } });
    expect(vfs.read("apps/web/src/app.tsx")).toBe('import { routes } from "./router";\n');
    expect(vfs.read("apps/web/src/lazy.ts")).toBe("const mod = import('./router');\n");
    expect(vfs.read("apps/api/src/app.ts")).toBe('import { routes } from "./routes";\n');
  });
});
