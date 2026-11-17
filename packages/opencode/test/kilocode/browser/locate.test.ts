import { describe, expect, test } from "bun:test"
import { locate } from "../../../src/kilocode/browser/locate"

const base = { home: "/Users/kilo", env: {}, platform: "darwin" as const }

function exists(paths: string[]) {
  return (candidate: string) => paths.includes(candidate)
}

describe("browser location", () => {
  test("prefers system Chrome", () => {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    expect(locate({ ...base, exists: exists([chrome, edge]) })).toEqual({ channel: "chrome" })
  })

  test("falls back to Edge", () => {
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    expect(locate({ ...base, exists: exists([edge]) })).toEqual({ channel: "msedge" })
  })

  test("uses the Playwright Chromium of the bundled playwright-core last", () => {
    expect(locate({ ...base, exists: exists(["/opt/ms-playwright/chromium-1200/chrome-linux/chrome"]), chromium: "/opt/ms-playwright/chromium-1200/chrome-linux/chrome" })).toEqual({
      executablePath: "/opt/ms-playwright/chromium-1200/chrome-linux/chrome",
    })
  })

  test("reports nothing when no browser is installed", () => {
    expect(locate({ ...base, exists: () => false, chromium: "/opt/ms-playwright/chromium/chrome" })).toBeUndefined()
  })

  test("finds Chrome from the Windows program files", () => {
    const platform = "win32" as const
    const path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    expect(
      locate({
        platform,
        home: "C:\\Users\\kilo",
        env: { PROGRAMFILES: "C:\\Program Files" },
        exists: exists([path]),
      }),
    ).toEqual({ channel: "chrome" })
  })

  test("finds Chrome on Linux", () => {
    expect(locate({ platform: "linux", home: "/home/kilo", env: {}, exists: exists(["/usr/bin/google-chrome"]) })).toEqual({
      channel: "chrome",
    })
  })
})
