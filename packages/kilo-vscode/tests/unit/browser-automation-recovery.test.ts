import { describe, expect, it } from "bun:test"
import {
  PLAYWRIGHT_MCP,
  PLAYWRIGHT_OUTPUT_DIR,
  playwrightBrowsers,
  playwrightCommand,
  playwrightRequest,
} from "../../src/services/browser-automation/settings"

describe("Playwright MCP command", () => {
  it("uses installed Chrome and a temp output directory", () => {
    expect(playwrightCommand({ browser: "chrome", headless: false })).toEqual([
      "npx",
      PLAYWRIGHT_MCP,
      "--browser",
      "chrome",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("adds headless and selects Playwright Chromium", () => {
    expect(playwrightCommand({ browser: "chromium", headless: true })).toEqual([
      "npx",
      PLAYWRIGHT_MCP,
      "--headless",
      "--browser",
      "chromium",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("passes device emulation and the viewport", () => {
    expect(playwrightCommand({ browser: "webkit", device: "iPhone 15", viewport: "390x844", headless: false })).toEqual(
      [
        "npx",
        PLAYWRIGHT_MCP,
        "--browser",
        "webkit",
        "--device",
        "iPhone 15",
        "--viewport-size",
        "390x844",
        "--output-dir",
        PLAYWRIGHT_OUTPUT_DIR,
      ],
    )
  })

  it("keeps artifacts outside the workspace", () => {
    const command = playwrightCommand({ browser: "chromium", headless: false })
    const index = command.indexOf("--output-dir")
    expect(command.at(index + 1)).not.toContain(process.cwd())
  })
})

describe("Playwright profile request", () => {
  const current = { browser: "chrome" as const, device: "Pixel 7", headless: true }
  const allowed = ["chrome" as const, "firefox" as const]

  it("only reads the profile when nothing is requested", () => {
    expect(playwrightRequest({}, current, allowed)).toBeUndefined()
  })

  it("keeps the browser and resets options that are not passed again", () => {
    expect(playwrightRequest({ viewport: " 800X600 " }, current, allowed)).toEqual({
      browser: "chrome",
      device: undefined,
      viewport: "800x600",
      headless: false,
    })
  })

  it("needs a browser for the first profile and shows the window by default", () => {
    expect(() => playwrightRequest({ device: "Pixel 7" }, undefined, allowed)).toThrow("No browser is running yet")
    expect(playwrightRequest({}, undefined, allowed)).toBeUndefined()
    expect(playwrightRequest({ browser: "firefox" }, undefined, allowed)).toEqual({
      browser: "firefox",
      device: undefined,
      viewport: undefined,
      headless: false,
    })
    expect(playwrightRequest({ browser: "chrome", headless: true }, undefined, allowed)).toMatchObject({
      headless: true,
    })
    expect(playwrightRequest({ headless: true }, current, allowed)).toMatchObject({ browser: "chrome", headless: true })
  })

  it("resolves device names to the Playwright spelling", () => {
    expect(playwrightRequest({ device: " iphone 15 " }, current, allowed)).toMatchObject({ device: "iPhone 15" })
    expect(playwrightRequest({ browser: "firefox", device: "desktop firefox" }, current, allowed)).toMatchObject({
      device: "Desktop Firefox",
    })
  })

  it("rejects browsers that are not allowed and invalid options", () => {
    expect(() => playwrightRequest({ browser: "webkit" }, current, allowed)).toThrow("not allowed")
    // A running browser the user no longer allows is named, not shown as undefined.
    expect(() => playwrightRequest({ device: "Pixel 7" }, { browser: "webkit", headless: false }, allowed)).toThrow(
      'Browser "webkit" is not allowed',
    )
    expect(() => playwrightRequest({ browser: "netscape" }, current, allowed)).toThrow("not allowed")
    expect(() => playwrightRequest({ browser: "firefox", device: "Pixel 7" }, current, allowed)).toThrow("mobile")
    expect(() => playwrightRequest({ viewport: "10x10" }, current, allowed)).toThrow("WIDTHxHEIGHT")
    expect(() => playwrightRequest({ device: "Nonexistent Phone" }, current, allowed)).toThrow("Unknown device")
  })
})

describe("Playwright allowed browsers", () => {
  it("keeps valid browsers in canonical order", () => {
    expect(playwrightBrowsers(["webkit", "netscape", "chrome", "webkit"])).toEqual(["chrome", "webkit"])
  })

  it("falls back to the old Use System Chrome toggle while the list is unset", () => {
    expect(playwrightBrowsers(undefined)).toEqual(["chrome"])
    expect(playwrightBrowsers(undefined, true)).toEqual(["chrome"])
    expect(playwrightBrowsers(undefined, false)).toEqual(["chromium"])
    expect(playwrightBrowsers([], false)).toEqual(["chromium"])
    expect(playwrightBrowsers(["firefox"], false)).toEqual(["firefox"])
  })
})

describe("Playwright MCP version", () => {
  it("pins an exact release instead of tracking latest", () => {
    expect(PLAYWRIGHT_MCP).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/)
  })
})
