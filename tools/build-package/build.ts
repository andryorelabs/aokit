import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { oxfmtStubPlugin } from "../build-shared/oxfmt-stubs.ts";

const shebang = "#!/usr/bin/env bun\n";

async function bundleEntry(packageDir: string, entry: string, outputName: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(packageDir, "src", "cli", entry)],
    outdir: join(packageDir, "dist"),
    naming: outputName,
    target: "bun",
    format: "esm",
    external: ["@oxc-parser/binding-*", "@oxfmt/binding-*"],
    define: { AOKIT_BUNDLED_REGISTRY_RELATIVE: JSON.stringify("../registry") },
    plugins: [oxfmtStubPlugin()],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `bun build of ${entry} failed`);
  }
}

async function ensureShebang(bundlePath: string): Promise<void> {
  const bundleSource = await Bun.file(bundlePath).text();
  const body = bundleSource.startsWith("#!")
    ? bundleSource.slice(bundleSource.indexOf("\n") + 1)
    : bundleSource;
  await Bun.write(bundlePath, `${shebang}${body}`);
  await chmod(bundlePath, 0o755);
}

/** Builds `dist/cli.js`, `dist/run.js` and the `registry/` copy of the aokit package at `packageDir`. */
export async function buildPackage(packageDir: string, registryDir: string): Promise<void> {
  await rm(join(packageDir, "dist"), { recursive: true, force: true });
  await rm(join(packageDir, "registry"), { recursive: true, force: true });
  await bundleEntry(packageDir, "main.ts", "cli.js");
  await bundleEntry(packageDir, "run.ts", "run.js");
  await ensureShebang(join(packageDir, "dist", "cli.js"));
  await mkdir(join(packageDir, "registry"), { recursive: true });
  await cp(registryDir, join(packageDir, "registry"), { recursive: true });
}
