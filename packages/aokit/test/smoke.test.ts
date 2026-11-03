import { expect, test } from "bun:test";
import { join } from "node:path";

const cliEntry = join(import.meta.dir, "..", "src", "cli", "main.ts");

test("the aokit bin entry runs and exits cleanly", async () => {
  const cliProcess = Bun.spawn(["bun", cliEntry], { stdout: "pipe", stderr: "pipe" });
  const standardError = await new Response(cliProcess.stderr).text();
  expect(standardError).toBe("");
  expect(await cliProcess.exited).toBe(0);
});

test("the aokit package declares the aokit bin without a shared barrel", async () => {
  const packageManifest: unknown = await Bun.file(
    join(import.meta.dir, "..", "package.json"),
  ).json();
  expect(packageManifest).toHaveProperty("bin", { aokit: "./src/cli/main.ts" });
  expect(packageManifest).not.toHaveProperty("main");
  expect(packageManifest).not.toHaveProperty("exports");
  expect(await Bun.file(join(import.meta.dir, "..", "src", "index.ts")).exists()).toBe(false);
});
