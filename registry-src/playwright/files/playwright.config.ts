import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:5173";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev",
    url: baseURL,
    reuseExistingServer: true,
  },
});
