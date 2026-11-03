import { posix } from "node:path";

/** The two supported Layouts. */
export type LayoutName = "single" | "monorepo";

/** One curated combination the real build creates: a Layout and a selection of Modules. */
export interface Combination {
  readonly layout: LayoutName;
  readonly modules: readonly string[];
}

/** The curated selections built for real, each on both Layouts. */
const curatedSelections: readonly (readonly string[])[] = [
  ["oxc", "knip", "vite-react", "tailwind4"],
  ["oxc", "hono", "docker", "coolify"],
];

/** Every curated combination: each curated selection on `single` and on `monorepo`. */
export const curatedCombinations: readonly Combination[] = curatedSelections.flatMap((modules) =>
  (["single", "monorepo"] as const).map((layout) => ({ layout, modules })),
);

/** Stable label of a combination, e.g. `single oxc,hono`. */
export function combinationLabel(combination: Combination): string {
  return `${combination.layout} ${combination.modules.join(",")}`;
}

/** A command to run in a Project directory, relative to the Project root. */
export interface Step {
  readonly name: string;
  readonly cwd: string;
  readonly kind: "install" | "build" | "typecheck";
  /** Arguments; for `typecheck` they follow the resolved `tsc` binary. */
  readonly args: readonly string[];
}

/** Compiler flags used for TypeScript files no `tsconfig.json` governs. */
const fallbackCompilerFlags: readonly string[] = [
  "--noEmit",
  "--strict",
  "--skipLibCheck",
  "--target",
  "ES2022",
  "--module",
  "ESNext",
  "--moduleResolution",
  "bundler",
  "--jsx",
  "react-jsx",
];

function byCodepoint(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function directoryOf(path: string): string {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
}

function ancestors(directory: string): string[] {
  const chain: string[] = [];
  let current = directory;
  for (;;) {
    chain.push(current);
    if (current === "") return chain;
    current = directoryOf(current);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scriptsOf(manifest: unknown): Record<string, unknown> {
  return isRecord(manifest) && isRecord(manifest["scripts"]) ? manifest["scripts"] : {};
}

function declaresDependency(manifest: unknown, name: string): boolean {
  if (!isRecord(manifest)) return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const section = manifest[field];
    return isRecord(section) && Object.hasOwn(section, name);
  });
}

function isTypeScriptSource(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/u.test(path) && !path.endsWith(".d.ts");
}

/**
 * The checks a created Project needs, in order: `bun install` at the root, `bun run build` in
 * every package that declares a `build` script, and a TypeScript typecheck. Each directory with a
 * `tsconfig.json` is checked with it; TypeScript files no `tsconfig.json` above them governs are
 * checked per nearest package with strict fallback flags (adding `bun` types when that package
 * or the root declares `@types/bun`).
 *
 * @param files Project-relative POSIX paths, `node_modules` excluded.
 * @param packageManifests Parsed `package.json` content keyed by Project-relative path.
 */
export function planSteps(
  files: readonly string[],
  packageManifests: Readonly<Record<string, unknown>>,
): Step[] {
  const sorted = files.toSorted(byCodepoint);
  const packageDirectories = new Set(
    Object.keys(packageManifests).map((path) => directoryOf(path)),
  );
  const steps: Step[] = [{ name: "install", cwd: "", kind: "install", args: ["install"] }];

  for (const directory of [...packageDirectories].toSorted(byCodepoint)) {
    const build = scriptsOf(packageManifests[posix.join(directory, "package.json")])["build"];
    if (typeof build === "string") {
      steps.push({
        name: `build ${directory === "" ? "." : directory}`,
        cwd: directory,
        kind: "build",
        args: ["run", "build"],
      });
    }
  }

  const tsconfigDirectories = new Set(
    sorted.filter((path) => posix.basename(path) === "tsconfig.json").map(directoryOf),
  );
  for (const directory of [...tsconfigDirectories].toSorted(byCodepoint)) {
    steps.push({
      name: `typecheck ${directory === "" ? "." : directory}`,
      cwd: directory,
      kind: "typecheck",
      args: ["--noEmit", "-p", "."],
    });
  }

  const uncovered = new Map<string, string[]>();
  for (const path of sorted.filter(isTypeScriptSource)) {
    const chain = ancestors(directoryOf(path));
    if (chain.some((directory) => tsconfigDirectories.has(directory))) continue;
    const owner = chain.find((directory) => packageDirectories.has(directory)) ?? "";
    uncovered.set(owner, [...(uncovered.get(owner) ?? []), posix.relative(owner, path)]);
  }
  for (const [directory, sources] of [...uncovered].toSorted(([left], [right]) =>
    byCodepoint(left, right),
  )) {
    const usesBunTypes = [directory, ""].some((candidate) =>
      declaresDependency(packageManifests[posix.join(candidate, "package.json")], "@types/bun"),
    );
    steps.push({
      name: `typecheck ${directory === "" ? "." : directory} (no tsconfig)`,
      cwd: directory,
      kind: "typecheck",
      args: [...fallbackCompilerFlags, ...(usesBunTypes ? ["--types", "bun"] : []), ...sources],
    });
  }
  return steps;
}
