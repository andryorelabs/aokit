import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oxfmtStubPlugin, stubbedPackages, stubModuleSource } from "./oxfmt-stubs.ts";

async function bundleImporting(packageName: string, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const entry = join(directory, "entry.ts");
  await writeFile(
    entry,
    `import * as stubbed from ${JSON.stringify(packageName)};\nstubbed.parse();\n`,
  );
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: join(directory, "out"),
    target: "bun",
    plugins: [oxfmtStubPlugin()],
  });
  expect(result.success, result.logs.map((log) => log.message).join("\n")).toBe(true);
  return join(directory, "out", "entry.js");
}

test("the plugin bundles an optional oxfmt import and the stub names the package when called", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-stub-"));
  try {
    await Promise.all(
      stubbedPackages.map(async (packageName) => {
        const bundlePath = await bundleImporting(
          packageName,
          join(directory, packageName.replace(/\W/g, "_")),
        );
        const child = Bun.spawn(["bun", bundlePath], { stdout: "pipe", stderr: "pipe" });
        const standardError = await new Response(child.stderr).text();
        expect(await child.exited).not.toBe(0);
        expect(standardError).toContain(`${packageName} is not bundled with aokit`);
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a stub module source embeds the stubbed package name in its error message", () => {
  expect(stubModuleSource("@astrojs/compiler-rs")).toContain(
    "@astrojs/compiler-rs is not bundled with aokit",
  );
});
