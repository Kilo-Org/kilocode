import { describe, expect, it } from "bun:test"
import { PLAYWRIGHT_OUTPUT_DIR, playwrightCommand } from "../../src/services/browser-automation/settings"

describe("Playwright MCP command", () => {
  it("uses system Chrome and a temp output directory by default", () => {
    expect(playwrightCommand({ headless: false, useSystemChrome: true })).toEqual([
      "npx",
      "@playwright/mcp@latest",
      "--browser",
      "chrome",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("adds headless and drops the Chrome channel", () => {
    expect(playwrightCommand({ headless: true, useSystemChrome: false })).toEqual([
      "npx",
      "@playwright/mcp@latest",
      "--headless",
      "--output-dir",
      PLAYWRIGHT_OUTPUT_DIR,
    ])
  })

  it("keeps artifacts outside the workspace", () => {
    const command = playwrightCommand({ headless: false, useSystemChrome: false })
    const index = command.indexOf("--output-dir")
    expect(command.at(index + 1)).not.toContain(process.cwd())
  })

  it("adds --user-data-dir when a profile path is provided", () => {
    const command = playwrightCommand({ headless: false, useSystemChrome: true, userDataDir: "/tmp/chrome-profile" })
    const index = command.indexOf("--user-data-dir")
    expect(index).toBeGreaterThanOrEqual(0)
    expect(command.at(index + 1)).toBe("/tmp/chrome-profile")
  })

  it("omits --user-data-dir when userDataDir is empty", () => {
    const command = playwrightCommand({ headless: false, useSystemChrome: true, userDataDir: "" })
    expect(command).not.toContain("--user-data-dir")
  })
})
