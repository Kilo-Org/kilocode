import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Number of parallel workers — defaults to half the CPU count locally,
  // override with PLAYWRIGHT_WORKERS env var or --workers CLI flag
  workers: process.env["PLAYWRIGHT_WORKERS"]
    ? Number.parseInt(process.env["PLAYWRIGHT_WORKERS"]!, 10) || undefined
    : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:6006",
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bunx storybook build -o ./storybook-static && bunx http-server ./storybook-static -p 6006 --silent",
    url: "http://localhost:6006",
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
  },
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
})
