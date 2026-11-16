import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["**/*.dom-test.tsx"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["**/*.browser-test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
