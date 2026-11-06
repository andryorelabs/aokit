import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Inputs for {@link findCoverageProblems}: all module paths are repo-relative POSIX paths.
 */
export interface CoverageManifestInput {
  /** Every `packages/*\/src/**\/*.ts` module. */
  readonly modules: readonly string[];
  /** Modules imported directly by at least one `*.test.ts`. */
  readonly importedModules: ReadonlySet<string>;
  /** Exempted module paths mapped to the reason they have no direct test. */
  readonly exemptions: Readonly<Record<string, string>>;
}

/**
 * Workspace package specifiers that `tsconfig.json` `paths` map to a source entry point.
 */
const workspaceAliases: Readonly<Record<string, string>> = {
  "@aokit/module": "packages/module/src/index.ts",
};

const moduleSuffixes = [".ts", "/index.ts"];
const relativeImportPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bmock\.module\s*\(\s*)["'](\.{1,2}\/[^"']*)["']/g;

/**
 * Lists files under `directory` whose repo-relative path satisfies `accept`, skipping `node_modules` and dot folders.
 */
function walk(root: string, directory: string, accept: (path: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return walk(root, full, accept);
    const repoRelative = relative(root, full).split("\\").join("/");
    return accept(repoRelative) ? [repoRelative] : [];
  });
}

/**
 * Lists every `packages/*\/src/**\/*.ts` source module, excluding test files and declarations.
 */
export function listSourceModules(root: string): string[] {
  return walk(
    root,
    join(root, "packages"),
    (path) =>
      /^packages\/[^/]+\/src\/.+\.ts$/.test(path) &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".d.ts"),
  ).toSorted();
}

/**
 * Lists every `*.test.ts` file in the workspace packages and `tools/`.
 */
export function listTestFiles(root: string): string[] {
  return [
    ...walk(root, join(root, "packages"), (path) => path.endsWith(".test.ts")),
    ...walk(root, join(root, "tools"), (path) => path.endsWith(".test.ts")),
  ].toSorted();
}

/**
 * Resolves a relative import specifier written in `importer` to a repo-relative module path, if one exists.
 */
function resolveSpecifier(root: string, importer: string, specifier: string): string | undefined {
  const base = resolve(root, dirname(importer), specifier);
  const candidates = [base, ...moduleSuffixes.map((suffix) => base + suffix)];
  if (base.endsWith(".js")) candidates.push(`${base.slice(0, -3)}.ts`);
  const found = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  return found === undefined ? undefined : relative(root, found).split("\\").join("/");
}

/**
 * Collects the modules that the given test files import directly through relative specifiers.
 */
export function collectImportedModules(root: string, testFiles: readonly string[]): Set<string> {
  const imported = new Set<string>();
  for (const testFile of testFiles) {
    const source = readFileSync(join(root, testFile), "utf8");
    for (const match of source.matchAll(relativeImportPattern)) {
      const resolved = resolveSpecifier(root, testFile, match[1] ?? "");
      if (resolved !== undefined) imported.add(resolved);
    }
    for (const [alias, target] of Object.entries(workspaceAliases)) {
      if (source.includes(`"${alias}"`)) imported.add(target);
    }
  }
  return imported;
}

/**
 * Returns one message per violation of the coverage manifest policy; empty means the manifest holds.
 */
export function findCoverageProblems(input: CoverageManifestInput): string[] {
  const problems: string[] = [];
  const known = new Set(input.modules);
  for (const modulePath of input.modules) {
    const exempt = Object.hasOwn(input.exemptions, modulePath);
    if (!input.importedModules.has(modulePath) && !exempt) {
      problems.push(`${modulePath} is not imported by any test and has no exemption`);
    }
  }
  for (const [modulePath, reason] of Object.entries(input.exemptions)) {
    if (reason.trim() === "") {
      problems.push(`exemption for ${modulePath} has an empty reason`);
    }
    if (!known.has(modulePath)) {
      problems.push(`exemption for ${modulePath} is stale: the module does not exist`);
    } else if (input.importedModules.has(modulePath)) {
      problems.push(`exemption for ${modulePath} is stale: a test now imports it`);
    }
  }
  return problems;
}
