import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { oxfmtStubPlugin } from "../build-shared/oxfmt-stubs.ts";
import { embeddedRegistryPlugin, nativeBindingPlugin } from "./plugins.ts";
import { type BinaryTarget, parseBinaryTarget } from "./targets.ts";

interface NativeLibraries {
  readonly parser: string;
  readonly oxfmt: string;
}

async function bindingFile(
  packageDir: string,
  packageName: string,
  scope: string,
  fileStem: string,
  target: BinaryTarget,
): Promise<string | undefined> {
  let packageRoot: string;
  try {
    packageRoot = await realpath(join(packageDir, "node_modules", packageName));
  } catch {
    return undefined;
  }
  const file = join(
    dirname(packageRoot),
    scope,
    `binding-${target.bindingSuffix}`,
    `${fileStem}.${target.bindingSuffix}.node`,
  );
  return (await Bun.file(file).exists()) ? file : undefined;
}

async function locateNativeLibraries(
  packageDir: string,
  target: BinaryTarget,
): Promise<NativeLibraries | undefined> {
  const parser = await bindingFile(packageDir, "oxc-parser", "@oxc-parser", "parser", target);
  const oxfmt = await bindingFile(packageDir, "oxfmt", "@oxfmt", "oxfmt", target);
  return parser === undefined || oxfmt === undefined ? undefined : { parser, oxfmt };
}

async function installTargetBindings(repoRoot: string, target: BinaryTarget): Promise<void> {
  const install = Bun.spawn(
    [
      "bun",
      "install",
      "--frozen-lockfile",
      "--silent",
      `--os=${target.os === "windows" ? "win32" : target.os}`,
      `--cpu=${target.cpu}`,
      `--libc=${target.libc}`,
    ],
    { cwd: repoRoot, stdout: "inherit", stderr: "inherit" },
  );
  if ((await install.exited) !== 0) {
    throw new Error(`bun install for the ${target.bindingSuffix} bindings failed`);
  }
}

async function nativeLibrariesFor(
  repoRoot: string,
  packageDir: string,
  target: BinaryTarget,
): Promise<NativeLibraries> {
  const present = await locateNativeLibraries(packageDir, target);
  if (present !== undefined) return present;
  await installTargetBindings(repoRoot, target);
  const installed = await locateNativeLibraries(packageDir, target);
  if (installed === undefined) {
    throw new Error(`The ${target.bindingSuffix} oxc-parser and oxfmt bindings are not installed.`);
  }
  return installed;
}

export interface BuildBinaryOptions {
  readonly repoRoot: string;
  readonly bunTarget: string;
}

/** Builds `dist/bin/aokit-<os>-<arch>[.exe]` for `bunTarget` and returns its path. */
export async function buildBinary(options: BuildBinaryOptions): Promise<string> {
  const target = parseBinaryTarget(options.bunTarget);
  const packageDir = join(options.repoRoot, "packages", "aokit");
  const libraries = await nativeLibrariesFor(options.repoRoot, packageDir, target);
  const outputDirectory = join(options.repoRoot, "dist", "bin");
  const outputPath = join(outputDirectory, target.outputName);
  await mkdir(outputDirectory, { recursive: true });
  await rm(outputPath, { force: true });
  const result = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.resolve("../../packages/aokit/src/cli/binary.ts"))],
    target: "bun",
    format: "esm",
    external: ["@oxc-parser/binding-*", "@oxfmt/binding-*"],
    plugins: [
      oxfmtStubPlugin(),
      nativeBindingPlugin(libraries),
      embeddedRegistryPlugin(join(options.repoRoot, "registry")),
    ],
    compile: {
      target: target.bunTarget,
      outfile: outputPath,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `bun build --compile for ${target.bunTarget} failed`);
  }
  return outputPath;
}
