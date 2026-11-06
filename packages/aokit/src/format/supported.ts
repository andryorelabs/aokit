import { posix } from "node:path";

/**
 * Oxfmt 0.75 exports only `format`, `defineConfig` and `jsTextToDoc`, so it offers no way to ask
 * which files it supports. aokit owns this allowlist and checks it before calling Oxfmt; a test pins
 * it to the installed version.
 */
export const oxfmtExtensions: readonly string[] = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".json5",
  ".css",
  ".scss",
  ".less",
  ".md",
  ".markdown",
  ".mdx",
  ".html",
  ".vue",
  ".yaml",
  ".yml",
  ".toml",
  ".graphql",
  ".gql",
  ".hbs",
  ".handlebars",
];

/** Extensionless config files Oxfmt formats as JSON or YAML. */
export const oxfmtFilenames: readonly string[] = [
  ".prettierrc",
  ".babelrc",
  ".swcrc",
  ".lintstagedrc",
  ".watchmanconfig",
];

/** Whether Oxfmt formats `path`; matches Oxfmt's case-sensitive extension handling. */
export function oxfmtSupports(path: string): boolean {
  const name = posix.basename(path);
  return oxfmtFilenames.includes(name) || oxfmtExtensions.includes(posix.extname(name));
}
