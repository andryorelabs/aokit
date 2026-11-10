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
});
