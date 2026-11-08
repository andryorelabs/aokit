import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const renovateConfigSchema = z.object({
  extends: z.array(z.string()),
  rangeStrategy: z.string(),
  minimumReleaseAge: z.string(),
  pinDigests: z.boolean(),
});

describe("renovate", () => {
  test.each(["single", "monorepo"] as const)(
    "writes renovate.json and the agents Region (%s)",
    async (layout) => {
      const built = await buildSelection(["renovate"], layout);
      if (!built.ok) throw new Error(built.error.message);
      const config = renovateConfigSchema.parse(
        JSON.parse(String(built.plan.vfs.read("renovate.json"))),
      );
      expect(config.extends).toEqual(["config:best-practices", "schedule:weekly"]);
      expect(config.rangeStrategy).toBe("bump");
      expect(config.minimumReleaseAge).toBe("3 days");
      expect(config.pinDigests).toBe(true);
      expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## renovate");
    },
  );
});
