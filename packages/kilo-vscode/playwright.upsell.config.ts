import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "agent-manager-upsell.spec.ts",
  outputDir: "./test-results/agent-manager-upsell",
  workers: 1,
  use: {
    baseURL: "http://localhost:6411",
    channel: "chrome",
    viewport: { width: 430, height: 800 },
    reducedMotion: "reduce",
  },
  webServer: {
    command: "bunx --no-install storybook dev --port 6411 --ci --no-open",
    url: "http://localhost:6411",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
