import { existsSync } from "node:fs"
import { chromium } from "playwright-core"

// An explicitly selected browser must launch; only skip when discovery found no browser at all.
export const executable =
  process.env.CHROME_PATH ||
  [
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync)

// Give Playwright time to terminate a failed launch before either test runner times out its setup hook.
export const launchTimeout = 30_000
export const hookTimeout = launchTimeout + 10_000
