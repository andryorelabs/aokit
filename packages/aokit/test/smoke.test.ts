import { expect, test } from "bun:test";
import { join } from "node:path";
import { spawnAokit } from "./helpers/aokit-process.ts";

test("the aokit bin entry runs and exits cleanly", async () => {
  const result = await spawnAokit([]);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("the aokit package declares the aokit bin without a shared barrel", async () => {
  const packageManifest: unknown = await Bun.file(
    join(import.meta.dir, "..", "package.json"),
  ).json();
  expect(packageManifest).toHaveProperty("bin", { aokit: "./bin/aokit.js" });
  expect(packageManifest).not.toHaveProperty("main");
  expect(packageManifest).toHaveProperty("exports", {
    "./cli": { types: "./dist/run.d.ts", default: "./dist/run.js" },
  });
  expect(await Bun.file(join(import.meta.dir, "..", "src", "index.ts")).exists()).toBe(false);
});
