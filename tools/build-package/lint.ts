import { join } from "node:path";

/** The `requiredEntries` missing from `packedPaths`; an entry ending in `/` is a directory prefix. */
export function findMissingTarballEntries(
  packedPaths: readonly string[],
  requiredEntries: readonly string[],
): string[] {
  return requiredEntries.filter(
    (entry) =>
      !packedPaths.some((path) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry)),
  );
}

async function runCommand(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed in ${cwd}:\n${stdout}${stderr}`);
  }
  return stdout;
}

/** The paths `npm pack` would put in the tarball of the package at `packageDir`. */
export async function packedPathsOf(packageDir: string): Promise<string[]> {
  const output = await runCommand(["npm", "pack", "--dry-run", "--json"], packageDir);
  const reports: unknown = JSON.parse(output);
  const report: unknown = Array.isArray(reports) ? reports[0] : undefined;
  if (typeof report !== "object" || report === null || !("files" in report)) {
    throw new Error(`npm pack reported no files for ${packageDir}.`);
  }
  const { files } = report;
  if (!Array.isArray(files)) {
    throw new Error(`npm pack reported no file list for ${packageDir}.`);
  }
  return files.flatMap((file: unknown) =>
    typeof file === "object" && file !== null && "path" in file && typeof file.path === "string"
      ? [file.path]
      : [],
  );
}

/** Lints the built package at `packageDir`: publint strict, attw on the tarball, and the tarball contents. */
export async function lintPackage(
  repoRoot: string,
  packageDir: string,
  requiredEntries: readonly string[],
): Promise<void> {
  const binDirectory = join(repoRoot, "node_modules", ".bin");
  await runCommand([join(binDirectory, "publint"), "--strict"], packageDir);
  await runCommand(
    [join(binDirectory, "attw"), "--pack", ".", "--profile", "esm-only"],
    packageDir,
  );
  const missing = findMissingTarballEntries(await packedPathsOf(packageDir), requiredEntries);
  if (missing.length > 0) {
    throw new Error(`${packageDir} tarball lacks: ${missing.join(", ")}`);
  }
}
