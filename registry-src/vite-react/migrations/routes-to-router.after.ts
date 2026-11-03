import { defineMigration } from "@aokit/module";

const routerPathSuffix = "src/router.tsx";
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];
const routesImportPattern = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])\.\/routes\2/g;

function rewriteSpecifier(_match: string, lead: string, quote: string): string {
  return `${lead}${quote}./router${quote}`;
}

/**
 * Rewrites `./routes` imports to `./router` in the `web` Target's `src`, after `routes.tsx` moved
 * to `router.tsx`.
 */
export default defineMigration(({ vfs }) => {
  const routerPath = vfs.list().find((path) => path.endsWith(routerPathSuffix));
  if (routerPath === undefined) {
    return;
  }
  const sourceRoot = routerPath.slice(0, routerPath.length - "router.tsx".length);
  for (const path of vfs.list(sourceRoot)) {
    if (path === routerPath || !sourceExtensions.some((extension) => path.endsWith(extension))) {
      continue;
    }
    const content = vfs.read(path);
    if (content === undefined) {
      continue;
    }
    const rewritten = content.replaceAll(routesImportPattern, rewriteSpecifier);
    if (rewritten !== content) {
      vfs.write(path, rewritten);
    }
  }
});
