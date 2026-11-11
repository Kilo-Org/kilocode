import { expect, test } from "bun:test"
import { chromiumProbe, executable } from "./fixtures/chromium"
import { node } from "./fixtures/node"

const probe = executable ? await chromiumProbe() : ({ state: "missing" } as const)

test.skipIf(probe.state !== "ready")(
  "browser network Chromium checks run in the extension host's Node runtime",
  async () => {
    const result = await node("browser-network", {
      timeout: 180_000,
      env: { ...process.env, CHROME_PATH: executable },
    })
    const skipped = process.env.KILO_BROWSER_GOOGLE_SMOKE === "1" ? 0 : 3
    expect(result.stdout).toMatch(/^# tests 28$/m)
    expect(result.stdout).toMatch(new RegExp(`^# pass ${28 - skipped}$`, "m"))
    expect(result.stdout).toMatch(new RegExp(`^# skipped ${skipped}$`, "m"))
    expect(result.stdout).toMatch(/^# fail 0$/m)
    expect(result.stdout).toMatch(/^# cancelled 0$/m)
  },
  190_000,
)

test.skipIf(probe.state !== "failed")("browser network Chromium launches", () => {
  if (probe.state === "failed") expect.unreachable(probe.reason)
})
