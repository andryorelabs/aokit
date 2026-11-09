import { defineMigration } from "@aokit/module";

const providerSuffix = "src/tailwind-provider.tsx";

const stockProvider = `import type { PropsWithChildren } from "react";

import.meta.glob("./styles.css", { eager: true });

export function TailwindProvider({ children }: PropsWithChildren) {
  return children;
}
`;

function withoutWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, "");
}

function isProviderPath(path: string): boolean {
  return path === providerSuffix || path.endsWith(`/${providerSuffix}`);
}

/**
 * Removes the `tailwind-provider.tsx` that tailwind4 1.x generated. A file the user edited is left
 * in place, so the Upgrade never deletes their work silently.
 */
export default defineMigration(({ vfs }) => {
  const stock = withoutWhitespace(stockProvider);
  for (const path of vfs.list().filter(isProviderPath)) {
    const content = vfs.read(path);
    if (content !== undefined && withoutWhitespace(content) === stock) {
      vfs.delete(path);
    }
  }
});
