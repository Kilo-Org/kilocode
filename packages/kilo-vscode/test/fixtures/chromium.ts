import { existsSync } from "node:fs"
import { chromium } from "playwright-core"
import { options } from "../../src/services/browser-automation/browser-runtime"

// Deliberately below the 20 s hook budgets the suites use: a launch that reaches this bound cannot be told apart
// from a hook timeout any more, and the hook timeout used to kill the child and orphan the Chromium (#15871).
const PROBE_TIMEOUT = 15_000

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
