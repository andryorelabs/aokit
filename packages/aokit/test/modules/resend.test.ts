import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import resendSource from "../../../../registry-src/resend/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const resend = parseManifest(resendSource);

async function build(layout: "single" | "monorepo", names: readonly string[] = ["resend"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("resend", () => {
  test("single writes the client under src/emails and the env key at the root", async () => {
    const vfs = await build("single");
    expect(String(vfs.read("src/emails/client.ts"))).toContain("createResendClient");
    expect(String(vfs.read(".env"))).toContain("RESEND_API_KEY=");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.dependencies).toMatchObject({ resend: "^6.37.0" });
  });

  test("monorepo lands the client and dependency under packages/emails", async () => {
    const vfs = await build("monorepo");
    expect(vfs.has("packages/emails/client.ts")).toBe(true);
    expect(vfs.has("src/emails/client.ts")).toBe(false);
    const emails = packageSchema.parse(
      JSON.parse(String(vfs.read("packages/emails/package.json"))),
    );
    expect(emails.dependencies).toMatchObject({ resend: "catalog:" });
  });

  test.each(["single", "monorepo"] as const)(
    "routes RESEND_API_KEY into the t3-env schema when selected (%s)",
    async (layout) => {
      const vfs = await build(layout, ["t3-env", "resend"]);
      const path = layout === "single" ? "src/env.ts" : "packages/config/src/env.ts";
      expect(String(vfs.read(path))).toContain("RESEND_API_KEY: z.string().min(1)");
    },
  );

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin resend:agents",
    );
  });

  test("provides email:send and coexists with react-email", async () => {
    expect(resend.provides.map((entry) => entry.capability)).toEqual(["email:send"]);
    const vfs = await build("single", ["react-email", "resend"]);
    expect(vfs.has("src/emails/welcome.tsx")).toBe(true);
    expect(vfs.has("src/emails/client.ts")).toBe(true);
  });
});
