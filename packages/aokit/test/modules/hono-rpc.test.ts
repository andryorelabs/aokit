import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import honoRpcSource from "../../../../registry-src/hono-rpc/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const honoRpc = parseManifest(honoRpcSource);

async function build(
  layout: "single" | "monorepo",
  names: readonly string[] = ["hono", "hono-rpc"],
) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("hono-rpc", () => {
  test("single writes the typed client under src/api-client", async () => {
    const vfs = await build("single");
    const client = String(vfs.read("src/api-client/client.ts"));
    expect(client).toContain('from "hono/client"');
    expect(client).toContain('import type { AppType } from "../app";');
    expect(client).toContain("hc<AppType>");
  });

  test("monorepo writes the client under packages/api-client importing the server app", async () => {
    const vfs = await build("monorepo");
    expect(vfs.has("src/api-client/client.ts")).toBe(false);
    const client = String(vfs.read("packages/api-client/client.ts"));
    expect(client).toContain('from "../../apps/server/src/app"');
    const manifest = packageSchema.parse(
      JSON.parse(String(vfs.read("packages/api-client/package.json"))),
    );
    expect(manifest.dependencies).toMatchObject({ hono: "catalog:" });
  });

  test("single places hono in the root package.json", async () => {
    const manifest = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(manifest.dependencies).toMatchObject({ hono: "^4.13.16" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin hono-rpc:agents",
    );
  });

  test("provides api:rpc and requires server.routes", () => {
    expect(honoRpc.provides.map((entry) => entry.capability)).toEqual(["api:rpc"]);
    expect(honoRpc.requires).toEqual(["ext:server.routes@^1"]);
  });

  test("fails without hono, naming the missing requirement", async () => {
    const built = await buildSelection(["hono-rpc"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("server.routes");
  });
});
