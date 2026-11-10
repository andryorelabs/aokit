import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "human-steps.sh");

describe("owner wizard", () => {
  test("is syntactically valid bash", async () => {
    const result = Bun.spawn(["bash", "-n", scriptPath], { stderr: "pipe", stdout: "pipe" });
    const exitCode = await result.exited;
    expect(await new Response(result.stderr).text()).toBe("");
    expect(exitCode).toBe(0);
  });

  test("never writes the npm token to disk", async () => {
    const source = await Bun.file(scriptPath).text();
    expect(source).not.toMatch(/NPM_PUBLISH_TOKEN[^\n]*>>?\s/);
    expect(source).not.toContain("npm config set");
  });

  test("declares as many stages as it runs", async () => {
    const source = await Bun.file(scriptPath).text();
    const declared = Number([...source.matchAll(/^TOTAL_STAGES=(\d+)$/gm)].at(-1)?.[1]);
    const stages = source.match(/^stage "/gm) ?? [];
    expect(stages.length).toBe(declared);
  });

  test("walks the owner through the npm org, first publish and trusted publisher of @aokit/module", async () => {
    const source = await Bun.file(scriptPath).text();
    expect(source).toContain('stage "npm org aokit"');
    expect(source).toContain("https://www.npmjs.com/org/create");
    expect(source).toContain("(cd packages/module/dist && bun pm pack");
    expect(source).toContain("https://www.npmjs.com/package/@aokit/module/access");
    expect(source).toContain("Workflow filename: release.yml");
  });
});
