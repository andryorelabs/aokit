import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Extension",
    description: "A browser extension built with WXT and React.",
    permissions: [],
  },
});
