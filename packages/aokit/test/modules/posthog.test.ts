import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const base = ["next", "posthog"] as const;

async function build(layout: "single" | "monorepo", names: readonly string[] = base) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("posthog", () => {
  test.each(["single", "monorepo"] as const)(
    "writes instrumentation, the provider and client env keys (%s)",
    async (layout) => {
      const vfs = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/instrumentation-client.ts`))).toContain(
        "posthog.init",
      );
      expect(String(vfs.read(`${directory}src/analytics/provider.tsx`))).toContain(
        "PostHogProvider",
      );
      const providers = String(vfs.read(`${directory}src/providers.tsx`));
      expect(providers).toContain("AnalyticsProvider");
      expect(providers).toContain("./analytics/provider");
      const env = String(vfs.read(`${directory}.env`));
      expect(env).toContain("NEXT_PUBLIC_POSTHOG_KEY=");
      expect(env).toContain("NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com");
    },
  );

  test("places its dependency per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ "posthog-js": "^1.447.3" });
    const web = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("apps/web/package.json"))),
    );
    expect(web.dependencies).toMatchObject({ "posthog-js": "catalog:" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin posthog:agents",
    );
  });

  test("fails without a Next base, naming the missing requirement", async () => {
    const built = await buildSelection(["posthog"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web.providers");
  });

  test("fails on a base without the App Router", async () => {
    const built = await buildSelection(["vite-react", "posthog"], "single");
    expect(built.ok).toBe(false);
  });
});
