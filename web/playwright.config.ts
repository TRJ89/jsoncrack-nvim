import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "renderer.spec.ts",
  outputDir: "./test-results/renderer",
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: "http://127.0.0.1:4173" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: {
    command: "python3 tests/serve_renderer.py",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
