import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

export const plugins: PluginOption[] = [react(), babel({ presets: [reactCompilerPreset()] })];

export default defineConfig({
  plugins,
});
