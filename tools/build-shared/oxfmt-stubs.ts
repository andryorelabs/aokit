import type { BunPlugin } from "bun";

/** Optional imports of oxfmt that aokit never uses and does not bundle. */
export const stubbedPackages: readonly string[] = [
  "@astrojs/compiler-rs",
  "@prettier/plugin-oxc",
  "@prettier/plugin-hermes",
  "@prettier/plugin-pug",
  "@shopify/prettier-plugin-liquid",
  "@zackad/prettier-plugin-twig",
  "prettier-plugin-marko",
  "vite-plus",
];

const stubFilter = new RegExp(
  `^(${stubbedPackages.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`,
);

/** Source of a stub module whose exports throw `"<name> is not bundled with aokit"` when called. */
export function stubModuleSource(packageName: string): string {
  const message = JSON.stringify(`${packageName} is not bundled with aokit`);
  return [
    `function notBundled() { throw new Error(${message}); }`,
    "export const parse = notBundled;",
    "export const parsers = new Proxy({}, { get: notBundled });",
    "export const languages = [];",
    "export const printers = {};",
    "export const options = {};",
    "export default new Proxy(notBundled, { get: notBundled });",
  ].join("\n");
}

/** A Bun build plugin that replaces oxfmt's optional imports with throwing stubs. */
export function oxfmtStubPlugin(): BunPlugin {
  return {
    name: "aokit-oxfmt-stubs",
    setup(build) {
      build.onResolve({ filter: stubFilter }, (args) => ({
        path: args.path,
        namespace: "aokit-oxfmt-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "aokit-oxfmt-stub" }, (args) => ({
        contents: stubModuleSource(args.path),
        loader: "js",
      }));
    },
  };
}
