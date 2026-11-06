import { existsSync } from "node:fs"
import { chromium } from "playwright-core"
import { options } from "../../src/services/browser-automation/browser-runtime"

// Both suites await the probe at module scope, so no hook or test budget applies and the launch may take longer than
// one. A 15 s bound failed on loaded 4 vCPU runners, where a cold launch exceeded it. The bound stays far below the
// job timeout, and a real launch failure still reports the path and error.
const PROBE_TIMEOUT = 45_000

export const executable = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  chromium.executablePath(),
].find((path) => path && existsSync(path))

export type Probe = { state: "missing" } | { state: "ready" } | { state: "failed"; reason: string }

let probe: Promise<Probe> | undefined

// One real launch per process, shared by every Chromium suite in the same test file run. A missing browser stays a
// skip; a browser that exists but cannot start fails once with the path and the launch error, because skipping would
// hide a broken runner or binary behind the skip that already covers machines without a browser.
export function chromiumProbe(): Promise<Probe> {
  return (probe ??= launch())
}

async function launch(): Promise<Probe> {
  if (!executable) return { state: "missing" }
  const browser = await chromium
    .launch({ ...options(false), executablePath: executable, timeout: PROBE_TIMEOUT })
    .then((browser) => browser)
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  if (browser instanceof Error) return { state: "failed", reason: message(browser) }
  await browser.close().catch(() => {})
  return { state: "ready" }
}

function message(error: Error) {
  const detail = error.message
    .split(/Browser logs:|Call log:/i)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  return `Chromium at ${executable} did not launch (probe timeout ${PROBE_TIMEOUT / 1000}s): ${detail || error.name}`
}
