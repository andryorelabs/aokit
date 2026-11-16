var defineMigration = (fn) => fn;

var routerPathSuffix = "src/router.tsx";
var sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];
var routesImportPattern = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])\.\/routes\2/g;
function rewriteSpecifier(_match, lead, quote) {
  return `${lead}${quote}./router${quote}`;
}
var routes_to_router_after_default = defineMigration(({ vfs }) => {
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
export {
  routes_to_router_after_default as default
};
