import { describe, expect, test } from "bun:test"
import { launchFailure } from "../../../src/kilocode/browser/playwright"

describe("playwright launch failures", () => {
  test("names the sandbox fix instead of a raw stack", () => {
    const error = launchFailure(
      new Error("Chromium sandboxing failed! Use --no-sandbox to work around."),
      "/opt/ms-playwright/chromium-1234/chrome-linux/chrome",
    )
    expect(error.message).toContain("Chromium sandboxing failed!")
    expect(error.message).toContain("sudo chown root:root /opt/ms-playwright/chromium-1234/chrome-linux/chrome_sandbox")
    expect(error.message).toContain("sudo chmod 4755 /opt/ms-playwright/chromium-1234/chrome-linux/chrome_sandbox")
    expect(error.message).toContain("kernel.apparmor_restrict_unprivileged_userns=0")
    expect(error.message).toContain("never disabled")
  })

  test("uses a placeholder path when the executable is unknown", () => {
    const error = launchFailure(new Error("sandbox is not permitted"))
    expect(error.message).toContain("<playwright-chromium>/chrome-linux/chrome_sandbox")
  })

  test("passes unrelated launch failures through unchanged", () => {
    const original = new Error("Executable doesn't exist at /opt/ms-playwright/chrome")
    expect(launchFailure(original)).toBe(original)
    expect(launchFailure("plain text")).toEqual(new Error("plain text"))
  })
})
