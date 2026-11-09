import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import reactEmailSource from "../../../../registry-src/react-email/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const reactEmail = parseManifest(reactEmailSource);

async function build(layout: "single" | "monorepo", names: readonly string[] = ["react-email"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function parseJson(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("react-email", () => {
  test("single writes the template under src/emails and the scripts at the root", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.has("src/emails/welcome.tsx")).toBe(true);
    const manifest = parseJson(plan.vfs, "package.json");
    expect(manifest.scripts).toMatchObject({
      "email:build": "bun run --cwd src/emails email build --dir .",
      "email:dev": "bun run --cwd src/emails email dev --dir .",
      "email:export": "bun run --cwd src/emails email export --dir .",
    });
    expect(manifest.dependencies).toMatchObject({ "@react-email/components": "^1.0.12" });
    expect(manifest.devDependencies).toMatchObject({ "react-email": "^6.11.8" });
  });

  test("monorepo lands the template and dependencies under packages/emails", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.has("packages/emails/welcome.tsx")).toBe(true);
    expect(plan.vfs.has("src/emails/welcome.tsx")).toBe(false);
    expect(parseJson(plan.vfs, "package.json").scripts).toMatchObject({
      "email:dev": "bun run --cwd packages/emails email dev --dir .",
    });
    const emails = parseJson(plan.vfs, "packages/emails/package.json");
    expect(emails.dependencies).toMatchObject({
      "@react-email/components": "catalog:",
      react: "catalog:",
    });
    expect(emails.devDependencies).toMatchObject({ "react-email": "catalog:" });
  });

  test("appends the agents Region", async () => {
    const { plan } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin react-email:agents");
  });

  test("coexists with a web base", async () => {
    const { plan } = await build("single", ["vite-react", "react-email"]);
    expect(plan.vfs.has("src/emails/welcome.tsx")).toBe(true);
  });

  test("provides email:templates and declares no requirements", () => {
    expect(reactEmail.provides.map((entry) => entry.capability)).toEqual(["email:templates"]);
    expect(reactEmail.requires).toEqual([]);
  });
});
