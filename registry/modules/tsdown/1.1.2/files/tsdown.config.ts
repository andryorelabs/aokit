import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  tsconfig: "tsconfig.lib.json",
  clean: true,
  outDir: "dist",
});
