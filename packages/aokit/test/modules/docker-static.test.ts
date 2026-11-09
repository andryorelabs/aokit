import { describe, expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import dockerStaticSource from "../../../../registry-src/docker-static/module.ts";
import { buildSelection } from "./support/index.ts";

const dockerStatic = parseManifest(dockerStaticSource);

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

describe("docker-static", () => {
  test.each([
    ["single", "."],
    ["monorepo", "apps/web"],
  ] as const)(
    "writes the nginx image files and copies the web output (%s)",
    async (layout, directory) => {
      const { plan } = await build(layout, ["vite-react", "docker-static"]);
      for (const path of ["Dockerfile", ".dockerignore", "nginx.conf", "docker-entrypoint.sh"]) {
        expect(plan.vfs.has(path)).toBe(true);
      }
      const dockerfile = String(plan.vfs.read("Dockerfile"));
      expect(dockerfile).toContain("FROM oven/bun:1 AS build");
      expect(dockerfile).toContain("FROM nginx:1-alpine");
      expect(dockerfile).toContain(`COPY --from=build /app/${directory}/dist`);
    },
  );

  test("nginx sets security headers and the SPA fallback", async () => {
    const { plan } = await build("single", ["vite-react", "docker-static"]);
    const config = String(plan.vfs.read("nginx.conf"));
    expect(config).toContain("X-Content-Type-Options");
    expect(config).toContain("Content-Security-Policy");
    expect(config).toContain("try_files $uri $uri/ /index.html;");
  });

  test("works over astro as the web:static provider", async () => {
    const { plan } = await build("single", ["astro", "docker-static"]);
    expect(plan.vfs.has("Dockerfile")).toBe(true);
  });

  test("appends the agents Region", async () => {
    const { plan } = await build("single", ["vite-react", "docker-static"]);
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin docker-static:agents");
  });

  test("provides deploy and container and requires web:static", () => {
    expect(dockerStatic.provides.map((entry) => entry.capability)).toEqual(["deploy", "container"]);
    expect(dockerStatic.requires).toEqual(["web:static"]);
  });

  test("fails without a web:static provider", async () => {
    const built = await buildSelection(["docker-static"], "single");
    expect(built.ok).toBe(false);
  });

  test("selecting docker with docker-static fails naming both", async () => {
    const built = await buildSelection(["vite-react", "docker", "docker-static"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("docker");
    expect(built.error.message).toContain("docker-static");
  });
});
