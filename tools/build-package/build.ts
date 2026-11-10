import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { oxfmtStubPlugin } from "../build-shared/oxfmt-stubs.ts";
import { buildModuleSdk } from "./module-sdk.ts";

const shebang = "#!/usr/bin/env bun\n";

const runDeclarationsPath = join(import.meta.dir, "assets", "run.d.ts");

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

async function ensureShebang(bundlePath: string, line: string): Promise<void> {
  const bundleSource = await Bun.file(bundlePath).text();
  const body = bundleSource.startsWith("#!")
    ? bundleSource.slice(bundleSource.indexOf("\n") + 1)
    : bundleSource;
  await Bun.write(bundlePath, `${line}${body}`);
  await chmod(bundlePath, 0o755);
}

/** Builds `dist/cli.js`, `dist/run.js` and the `registry/` copy of the aokit package at `packageDir`. */
export async function buildPackage(packageDir: string, registryDir: string): Promise<void> {
  await rm(join(packageDir, "dist"), { recursive: true, force: true });
  await rm(join(packageDir, "registry"), { recursive: true, force: true });
  await bundleEntry(packageDir, "main.ts", "cli.js");
  await bundleEntry(packageDir, "run.ts", "run.js");
  await ensureShebang(join(packageDir, "dist", "cli.js"), shebang);
  await cp(runDeclarationsPath, join(packageDir, "dist", "run.d.ts"));
  await mkdir(join(packageDir, "registry"), { recursive: true });
  await cp(registryDir, join(packageDir, "registry"), { recursive: true });
}

/** Builds `dist/main.js`, the Node bin of the create-aokit package at `packageDir`. */
async function buildCreateAokit(packageDir: string): Promise<void> {
  await rm(join(packageDir, "dist"), { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(packageDir, "src", "main.ts")],
    outdir: join(packageDir, "dist"),
    naming: "main.js",
    target: "node",
    format: "esm",
    external: ["aokit", "aokit/*"],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "bun build of create-aokit failed");
  }
  await ensureShebang(join(packageDir, "dist", "main.js"), "#!/usr/bin/env node\n");
}

async function copyPackageDocuments(
  repoRoot: string,
  packageDir: string,
  packageName: string,
): Promise<void> {
  await cp(join(repoRoot, "LICENSE"), join(packageDir, "LICENSE"));
  await cp(
    join(repoRoot, "tools", "build-package", "assets", `${packageName}.md`),
    join(packageDir, "README.md"),
  );
}

/**
 * Builds the three publishable packages under `repoRoot/packages` and copies the LICENSE and a
 * README into each; `@aokit/module` is staged in its `dist/`, the directory that is packed.
 */
export async function buildPackages(repoRoot: string): Promise<void> {
  const aokitDir = join(repoRoot, "packages", "aokit");
  const createAokitDir = join(repoRoot, "packages", "create-aokit");
  await buildPackage(aokitDir, join(repoRoot, "registry"));
  await buildCreateAokit(createAokitDir);
  await copyPackageDocuments(repoRoot, aokitDir, "aokit");
  await copyPackageDocuments(repoRoot, createAokitDir, "create-aokit");
  await buildModuleSdk(repoRoot, join(repoRoot, "packages", "module"));
}
