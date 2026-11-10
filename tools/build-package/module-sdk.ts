import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** The prefix `publishConfig.exports` targets carry, relative to the package root. */
const distPrefix = "./dist/";

/** Fields of the source manifest that are workspace-only and never reach the published one. */
const workspaceOnlyFields = new Set(["scripts", "devDependencies"]);

/**
 * Rewrites relative `.ts` module specifiers in emitted declarations to the `.js` files they
 * describe, so Node16 and NodeNext resolution finds the sibling `.d.ts`.
 */
export function rewriteRelativeTsSpecifiers(declarations: string): string {
  return declarations.replaceAll(/(["']\.{1,2}\/[^"'\n]*)\.ts(["'])/g, "$1.js$2");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripDistPrefix(value: unknown): unknown {
  if (typeof value === "string") {
    if (!value.startsWith(distPrefix)) {
      throw new Error(`publishConfig.exports target ${value} is not under ${distPrefix}`);
    }
    return `./${value.slice(distPrefix.length)}`;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripDistPrefix(entry)]),
    );
  }
  throw new Error(`publishConfig.exports holds an unsupported value: ${JSON.stringify(value)}`);
}

/**
 * The manifest published from the staged `dist/`: `publishConfig.exports` becomes `exports`
 * relative to `dist/`, `files` lists only JS and declarations, and workspace-only fields drop.
 */
export function publishManifestOf(source: Record<string, unknown>): Record<string, unknown> {
  const publishConfig = source["publishConfig"];
  if (!isRecord(publishConfig) || publishConfig["exports"] === undefined) {
    throw new Error("the package manifest has no publishConfig.exports to publish");
  }
  const { exports: publishedExports, ...remainingPublishConfig } = publishConfig;
  const manifest: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(source)) {
    if (workspaceOnlyFields.has(field)) {
      continue;
    }
    if (field === "files") {
      manifest[field] = ["*.js", "*.d.ts"];
    } else if (field === "exports") {
      manifest[field] = stripDistPrefix(publishedExports);
    } else if (field === "publishConfig") {
      manifest[field] = remainingPublishConfig;
    } else {
      manifest[field] = value;
    }
  }
  manifest["exports"] ??= stripDistPrefix(publishedExports);
  return manifest;
}

async function runCommand(command: readonly string[], cwd: string): Promise<void> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed in ${cwd}:\n${stdout}${stderr}`);
  }
}

async function bundleJavaScript(packageDir: string, distDir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(packageDir, "src", "index.ts")],
    outdir: distDir,
    naming: "index.js",
    target: "node",
    format: "esm",
    packages: "external",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "bun build of @aokit/module failed");
  }
}

async function emitDeclarations(repoRoot: string, packageDir: string, distDir: string) {
  const compiler = join(repoRoot, "node_modules", "typescript7", "bin", "tsc");
  await runCommand(
    [
      compiler,
      "--ignoreConfig",
      "--declaration",
      "--emitDeclarationOnly",
      "--strict",
      "--skipLibCheck",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--allowImportingTsExtensions",
      "--verbatimModuleSyntax",
      "--types",
      "bun",
      "--rootDir",
      join(packageDir, "src"),
      "--outDir",
      distDir,
      join(packageDir, "src", "index.ts"),
    ],
    repoRoot,
  );
  const declarationPaths = (await readdir(distDir))
    .filter((fileName) => fileName.endsWith(".d.ts"))
    .map((fileName) => join(distDir, fileName));
  await Promise.all(
    declarationPaths.map(async (path) => {
      await Bun.write(path, rewriteRelativeTsSpecifiers(await Bun.file(path).text()));
    }),
  );
}

/**
 * Builds `@aokit/module` at `packageDir` into `dist/`, the directory that is packed and published:
 * the ESM bundle `index.js`, one `.d.ts` per source file, the publish manifest, the LICENSE and the
 * npm README.
 */
export async function buildModuleSdk(repoRoot: string, packageDir: string): Promise<void> {
  const distDir = join(packageDir, "dist");
  await rm(distDir, { recursive: true, force: true });
  await bundleJavaScript(packageDir, distDir);
  await emitDeclarations(repoRoot, packageDir, distDir);
  const source: unknown = await Bun.file(join(packageDir, "package.json")).json();
  if (!isRecord(source)) {
    throw new Error(`${packageDir}/package.json is not a JSON object`);
  }
  await Bun.write(
    join(distDir, "package.json"),
    `${JSON.stringify(publishManifestOf(source), null, 2)}\n`,
  );
  await cp(join(repoRoot, "LICENSE"), join(distDir, "LICENSE"));
  await cp(
    join(repoRoot, "tools", "build-package", "assets", "module.md"),
    join(distDir, "README.md"),
  );
}
