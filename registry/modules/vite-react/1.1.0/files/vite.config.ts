import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

export const plugins: PluginOption[] = [react()];

export default defineConfig({
  plugins,
});
