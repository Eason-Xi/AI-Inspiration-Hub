import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:3103/api/workspace",
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:3103",
    headless: true,
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
