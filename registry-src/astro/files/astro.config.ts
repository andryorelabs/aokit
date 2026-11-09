import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import type { PluginOption } from "vite";

export const integrations = [react()];

export const plugins: PluginOption[] = [];

export default defineConfig({
  integrations,
  vite: { plugins },
});
