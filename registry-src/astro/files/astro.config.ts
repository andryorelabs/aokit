import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import type { PluginOption } from "vite";

export const integrations = [react()];

export const plugins: PluginOption[] = [];

/**
 * Resolves `@import "tailwindcss"` to the package stylesheet; without it the Vite CSS resolver
 * falls back to a relative path under Astro and the build fails with ENOENT.
 */
const stylesheetAliases = [{ find: /^tailwindcss$/, replacement: "tailwindcss/index.css" }];

export default defineConfig({
  integrations,
  vite: { plugins, resolve: { alias: stylesheetAliases } },
});
