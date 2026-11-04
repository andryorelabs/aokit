import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BunPlugin } from "bun";

/** Resolves `aokit-native:parser` and `aokit-native:oxfmt` to the target's `.node` files, embedded as assets. */
export function nativeBindingPlugin(libraryPaths: {
  readonly parser: string;
  readonly oxfmt: string;
}): BunPlugin {
  return {
    name: "aokit-native-bindings",
    setup(build) {
      build.onResolve({ filter: /embedded\/native-(parser|oxfmt)-library\.ts$/ }, (args) => ({
        path: args.path.endsWith("native-parser-library.ts")
          ? libraryPaths.parser
          : libraryPaths.oxfmt,
        namespace: "aokit-native-file",
      }));
      build.onLoad({ filter: /.*/, namespace: "aokit-native-file" }, (args) => ({
        contents: `import library from ${JSON.stringify(args.path)} with { type: "file" };\nexport default library;`,
        loader: "js",
      }));
    },
  };
}

function compareByCodepoint(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Relative paths (forward slashes, sorted) of every file under `registryDir`. */
async function listRegistryFiles(registryDir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: registryDir, onlyFiles: true })) {
    found.push(path.replaceAll("\\", "/"));
  }
  return found.toSorted(compareByCodepoint);
}

/** SHA-256 (first 16 hex digits) over the sorted relative paths and bytes of the Registry files. */
async function hashRegistryFiles(registryDir: string, files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(`${path}\0`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- hashed serially to keep the order stable
    hash.update(new Uint8Array(await Bun.file(join(registryDir, path)).arrayBuffer()));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Resolves `aokit-embedded-registry` to a manifest of the Registry files embedded as assets. */
export function embeddedRegistryPlugin(registryDir: string): BunPlugin {
  return {
    name: "aokit-embedded-registry",
    setup(build) {
      build.onResolve({ filter: /embedded\/generated-registry\.ts$/ }, (args) => ({
        path: args.path,
        namespace: "aokit-embedded-registry",
      }));
      build.onLoad({ filter: /.*/, namespace: "aokit-embedded-registry" }, async () => {
        const files = await listRegistryFiles(registryDir);
        const contentHash = await hashRegistryFiles(registryDir, files);
        const imports = files.map(
          (path, index) =>
            `import file${index} from ${JSON.stringify(join(registryDir, path))} with { type: "file" };`,
        );
        const entries = files.map(
          (path, index) => `{ path: ${JSON.stringify(path)}, source: file${index} }`,
        );
        return {
          contents: [
            ...imports,
            `export const embeddedRegistry = { contentHash: ${JSON.stringify(contentHash)}, files: [${entries.join(", ")}] };`,
          ].join("\n"),
          loader: "js",
        };
      });
    },
  };
}
