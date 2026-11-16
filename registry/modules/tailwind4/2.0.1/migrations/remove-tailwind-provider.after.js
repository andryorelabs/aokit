var defineMigration = (fn) => fn;

var providerSuffix = "src/tailwind-provider.tsx";
var stockProvider = `import type { PropsWithChildren } from "react";

import.meta.glob("./styles.css", { eager: true });

export function TailwindProvider({ children }: PropsWithChildren) {
  return children;
}
`;
function withoutWhitespace(text) {
  return text.replaceAll(/\s+/g, "");
}
function isProviderPath(path) {
  return path === providerSuffix || path.endsWith(`/${providerSuffix}`);
}
var remove_tailwind_provider_after_default = defineMigration(({ vfs }) => {
  const stock = withoutWhitespace(stockProvider);
  for (const path of vfs.list().filter(isProviderPath)) {
    const content = vfs.read(path);
    if (content !== undefined && withoutWhitespace(content) === stock) {
      vfs.delete(path);
    }
  }
});
export {
  remove_tailwind_provider_after_default as default
};
